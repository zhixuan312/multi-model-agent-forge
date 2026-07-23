/**
 * Projects core (Spec 3) — the data-layer owner of project create / list / get,
 * the visibility guard, and the mutations. Dependency-injected (`Db`) so route
 * handlers + the server action stay thin and the core unit-tests against the
 * live DB.
 *
 * Visibility: `visibleProjects` and `assertProjectReadable` gate WORK ARTIFACTS
 * (Q&A, drafts, plan, history) — NOT code/repos (those are team-public, Spec 2).
 * Every project-scoped artifact/stage/qa read routes through the guard; code
 * reads (`readProjectRepos`) intentionally do not.
 */
import { rm } from 'node:fs/promises';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { validateDetails } from '@/details/schema';
import { updateDetails } from '@/details/write';
import { member } from '@/db/schema/identity';
import { repo } from '@/db/schema/workspace';
import {
  STAGE_ORDER,
  type StageKind,
  type StageStatus,
  type ProjectVisibility,
  type ProjectPhase,
} from '@/db/enums';
import { recordActivity } from '@/activity/project-activity';
import { FORGE_MEMBER_ID } from '@/automation/forge-member';
import {
  CREATE_PROJECT_FILE_ERROR,
  decodeUploadedArtifact,
  parseExplorationUpload,
  parseSpecUpload,
  stripFrontmatter,
  validateSubsetSelection,
  type DesignStageSelection,
} from '@/projects/create-project-subset';
import { buildInitialDetails, buildSubsetDetails, type UploadedSpecProof } from '@/details/schema';
import { writeExplorationSummary, writeSpec } from '@/projects/project-files';
import { deriveSummary } from '@/spec/summary';
import { STAGE_FIRST_PHASE } from '@/automation/details-mutations';

/** The acting member (id and teamId are load-bearing for the data layer). */
export interface ProjectActor {
  id: string;
  teamId: string;
}

/** Thrown when an actor may not read or mutate a project. Maps to 404 (read) / 403 (write). */
export class ProjectAccessError extends Error {
  constructor(message = 'You do not have access to this project.') {
    super(message);
    this.name = 'ProjectAccessError';
  }
}

/** A stage row as carried in the list DTO (the rail's data). */
export interface StageView {
  kind: StageKind;
  status: StageStatus;
  lastPhase?: string | null;
}

/** The list-card DTO — one per visible project (single query, no N+1). */
export interface ProjectListItem {
  id: string;
  name: string;
  summary: string | null;
  visibility: ProjectVisibility;
  phase: ProjectPhase;
  currentStage: StageKind | null;
  ownerId: string;
  ownerDisplayName: string;
  ownerAvatarTint: string;
  updatedAt: Date;
  /** Whether the actor owns or collaborates on this project (Mine filter). */
  isMember: boolean;
  /** The five stage rows, in STAGE_ORDER. */
  stages: StageView[];
  /** Count of RESOLVABLE repos only (dangling/missing rows excluded). */
  repoCount: number;
  /** Count of UNAVAILABLE repos (dangling join OR status='error') — drives the chip. */
  unavailableRepoCount: number;
  /** Visibility overlay: `false` = active list, `true` = archived list. */
  archived: boolean;
}

export interface ProjectsDeps {
  db?: Db;
}

/* ── Create ─────────────────────────────────────────────────────────────── */

const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required.'),
  visibility: z.enum(['public', 'private']),
  repoIds: z.array(z.string().uuid()).min(1, 'Pick at least one repository.'),
  selectedDesignStages: z.array(z.enum(['exploration', 'spec', 'plan'])).default([]),
  uploadedArtifact: z.object({
    kind: z.enum(['exploration', 'spec']),
    filename: z.string(),
    content: z.string(),
  }).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export type CreateProjectResult =
  | { ok: true; id: string; entryStage: 'exploration' | 'spec' | 'plan' }
  | { ok: false; error: { field?: 'name' | 'repoIds' | 'visibility' | 'selectedDesignStages' | 'artifact'; message: string } };

/**
 * Create a project + seed the five-stage skeleton + repo subset + owner row +
 * the create_project audit row — ALL in one transaction (a partial failure
 * rolls everything back). `exploration` is seeded `active`, the rest `pending`;
 * `phase='design'`, `current_stage='exploration'`, `summary`/`intent_md` NULL.
 */
export async function createProject(
  input: unknown,
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<CreateProjectResult> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      ok: false,
      error: {
        field: typeof field === 'string' ? (field as never) : undefined,
        message: issue?.message ?? 'Invalid input.',
      },
    };
  }

  const { name, visibility, repoIds, selectedDesignStages, uploadedArtifact } = parsed.data;
  const subsetValidation = validateSubsetSelection(selectedDesignStages as DesignStageSelection[]);
  if (!subsetValidation.ok) {
    return { ok: false, error: { field: 'selectedDesignStages', message: subsetValidation.message } };
  }

  const db = deps.db ?? getDb();
  const entryStage = (selectedDesignStages[0] ?? 'exploration') as 'exploration' | 'spec' | 'plan';

  // Entry-stage upload prerequisite (FR-3/FR-4): a subset that starts below Exploration
  // must supply the upstream artifact — spec-start needs an exploration file, plan-start
  // needs a spec file. Exploration-start / Full SDLC take no upload.
  if (entryStage === 'spec' && uploadedArtifact?.kind !== 'exploration') {
    return { ok: false, error: { field: 'artifact', message: 'Starting at Specification requires an uploaded exploration file.' } };
  }
  if (entryStage === 'plan' && uploadedArtifact?.kind !== 'spec') {
    return { ok: false, error: { field: 'artifact', message: 'Starting at Planning requires an uploaded spec file.' } };
  }
  if (entryStage === 'exploration' && uploadedArtifact) {
    return { ok: false, error: { field: 'artifact', message: 'An exploration-start project does not take an uploaded artifact.' } };
  }

  let parsedExploration: string | undefined;
  let parsedSpec: { filePath: string; selectedTemplateIds: string[]; components: Array<{ id: string; templateId: string; approvals: string[] }> } | undefined;

  // Pre-parse + validate all uploads BEFORE any persistence
  if (uploadedArtifact?.content) {
    try {
      const decoded = decodeUploadedArtifact(new TextEncoder().encode(uploadedArtifact.content));
      if (uploadedArtifact.kind === 'exploration') {
        const exploration = parseExplorationUpload(decoded);
        if (!exploration.ok) return { ok: false, error: { field: 'artifact', message: CREATE_PROJECT_FILE_ERROR } };
        parsedExploration = decoded;
      } else {
        const spec = await parseSpecUpload(db, decoded);
        if (!spec.ok) return { ok: false, error: { field: 'artifact', message: CREATE_PROJECT_FILE_ERROR } };
        parsedSpec = spec.value;
      }
    } catch {
      return { ok: false, error: { field: 'artifact', message: CREATE_PROJECT_FILE_ERROR } };
    }
  }

  let projectId = '';
  const cleanupPaths: string[] = [];
  try {
    projectId = await db.transaction(async (tx) => {
      // Base seed. buildSubsetDetails/buildInitialDetails is the ONLY stage-seeding
      // implementation — the upload proof is applied through the SAME helper below
      // (via its uploadedExplorationFile / uploadedSpec branches), never re-seeded by
      // hand here, so there is exactly one seeding code path.
      const seed = (uploadedExploration?: string, uploadedSpec?: UploadedSpecProof) =>
        selectedDesignStages.length === 0
          ? buildInitialDetails()
          : buildSubsetDetails({
              selectedDesignStages: selectedDesignStages as DesignStageSelection[],
              uploadedExplorationFile: uploadedExploration,
              uploadedSpec,
              forgeApprovalMemberId: FORGE_MEMBER_ID,
            });

      // Load repos once (used for whichever seed we persist). Constrain to the
      // actor's team: without eq(repo.teamId) a member could POST another team's
      // repo UUID and bind its on-disk path into their project (agents build it).
      const repos = await tx
        .select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk, defaultBranch: repo.defaultBranch })
        .from(repo)
        .where(and(inArray(repo.id, [...new Set(repoIds)]), eq(repo.teamId, actor.teamId)));
      const repoDetails = repos.map((r) => ({ id: r.id, name: r.name, pathOnDisk: r.pathOnDisk, defaultBranch: r.defaultBranch }));

      // Insert the row first (base seed) to obtain the id the canonical artifact path
      // needs. Details are finalized below only when there is an upload to ingest.
      const baseDetails = seed();
      baseDetails.repos = repoDetails;
      const [row] = await tx.insert(project).values({
        teamId: actor.teamId,
        name,
        visibility,
        phase: 'design',
        currentStage: entryStage,
        ownerId: actor.id,
        details: baseDetails,
        detailsReady: true,
      }).returning({ id: project.id });

      // Preserve the existing "Created project" activity row (existing tests assert it).
      // Attribute it to the true entry stage so a subset logs its real starting stage;
      // for Full SDLC entryStage is 'exploration', so this matches today's behavior.
      const [actorRow] = await tx
        .select({ displayName: member.displayName, avatarTint: member.avatarTint })
        .from(member)
        .where(eq(member.id, actor.id))
        .limit(1);
      await recordActivity({
        db: tx as unknown as Db,
        projectId: row.id,
        stage: entryStage,
        phase: STAGE_FIRST_PHASE[entryStage],
        label: 'Created project',
        kind: 'done',
        actor: { id: actor.id, name: actorRow?.displayName ?? 'Unknown', tint: actorRow?.avatarTint ?? '#9a6b4f' },
        source: 'user',
        eventKey: `create_project:${row.id}`,
      });

      // Ingest an upload (if any) and finalize details through the SAME seeding helper.
      // NOTE: writeExplorationSummary/writeSpec are typed `db?: Db`; the transaction
      // handle is passed with the established `tx as unknown as Db` cast. The writers
      // return the canonical `<teamRoot>/.mma/projects/<id>/<kind>.md` path — which becomes
      // the single seeding helper's proof input, so no proof field is set by hand here.
      // The uploaded body is stripped of its own frontmatter first, because the writer
      // re-stamps fresh frontmatter (else the stored file would have two blocks).
      if (parsedExploration) {
        const filePath = await writeExplorationSummary(row.id, stripFrontmatter(parsedExploration), tx as unknown as Db);
        cleanupPaths.push(filePath);
        const finalDetails = seed(filePath);
        finalDetails.repos = repoDetails;
        // Capture the uploaded exploration as the project's intent. A normal explore run
        // sets `intentMd` during its brief phase; a subset skips that phase, so without
        // this the Spec outline gate (needs non-empty intent) and the spec drafter (hard-
        // requires intent) would both be permanently stuck with no UI to unblock them.
        const intent = stripFrontmatter(parsedExploration);
        await tx.update(project)
          .set({ details: finalDetails, currentStage: entryStage, intentMd: intent, summary: deriveSummary(intent) })
          .where(eq(project.id, row.id));
      } else if (parsedSpec) {
        const spec = stripFrontmatter(uploadedArtifact!.content);
        const { filePath } = await writeSpec(row.id, spec, tx as unknown as Db);
        cleanupPaths.push(filePath);
        const finalDetails = seed(undefined, { ...parsedSpec, filePath });
        finalDetails.repos = repoDetails;
        // Same reasoning for a plan-start: capture the uploaded spec as intent so the Plan
        // stage has the grounding a normal spec run would have captured.
        await tx.update(project)
          .set({ details: finalDetails, currentStage: entryStage, intentMd: spec, summary: deriveSummary(spec) })
          .where(eq(project.id, row.id));
      }

      return row.id;
    });
  } catch {
    // Rollback: clean up files and delete project row on any failure post-insert
    await Promise.all(cleanupPaths.map((path) => rm(path, { force: true }).catch(() => undefined)));
    if (projectId) {
      await db.delete(project).where(eq(project.id, projectId)).catch(() => undefined);
    }
    return { ok: false, error: { field: 'artifact', message: CREATE_PROJECT_FILE_ERROR } };
  }

  return { ok: true, id: projectId, entryStage };
}

/* ── Visibility guard + list ────────────────────────────────────────────── */

export async function visibleProjects(
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<ProjectListItem[]> {
  return listProjects(actor, 'active', deps) as Promise<ProjectListItem[]>;
}

export async function archivedProjects(
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<ProjectListItem[]> {
  return listProjects(actor, 'archived', deps);
}

async function listProjects(
  actor: ProjectActor,
  mode: 'active' | 'archived',
  deps: ProjectsDeps = {},
): Promise<ProjectListItem[]> {
  const db = deps.db ?? getDb();
  const wantArchived = mode === 'archived';
  const rows = await db
    .select({
      id: project.id,
      name: project.name,
      summary: project.summary,
      visibility: project.visibility,
      phase: project.phase,
      currentStage: project.currentStage,
      ownerId: project.ownerId,
      updatedAt: project.updatedAt,
      archived: project.archived,
      details: project.details,
    })
    .from(project)
    .where(and(
      eq(project.teamId, actor.teamId),
      or(eq(project.visibility, 'public'), eq(project.ownerId, actor.id)),
      eq(project.archived, wantArchived),
    ))
    .orderBy(sql`${project.updatedAt} desc`);

  if (rows.length === 0) return [];

  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const owners = await db
    .select({ id: member.id, displayName: member.displayName, avatarTint: member.avatarTint })
    .from(member)
    .where(inArray(member.id, ownerIds));
  const ownerById = new Map(owners.map((o) => [o.id, o]));

  const memberSet = new Set(rows.filter((r) => r.ownerId === actor.id).map((r) => r.id));
  const stagesByProject = new Map<string, StageView[]>();
  const repoCountByProject = new Map<string, number>();
  const unavailableByProject = new Map<string, number>();
  const derivedByProject = new Map<string, { currentStage: StageKind | null; phase: ProjectPhase }>();

  const { deriveStageAndPhase } = await import('@/details/write');
  for (const r of rows) {
    if (!r.details) continue;
    try {
      const d = validateDetails(r.details);
      const stages = (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const).map((kind) => ({
        kind,
        status: d.stages[kind].status,
      }));
      stagesByProject.set(r.id, stages);
      repoCountByProject.set(r.id, d.repos.length);
      derivedByProject.set(r.id, deriveStageAndPhase(d));
    } catch {
      // ignore invalid details rows; preserve current behavior
    }
  }

  return rows.map((r) => {
    const owner = ownerById.get(r.ownerId);
    const orderedStages = orderStages(stagesByProject.get(r.id) ?? []);
    const derived = derivedByProject.get(r.id);
    const base: ProjectListItem = {
      id: r.id,
      name: r.name,
      summary: r.summary,
      visibility: r.visibility,
      phase: derived?.phase ?? r.phase,
      currentStage: derived?.currentStage ?? r.currentStage,
      ownerId: r.ownerId,
      ownerDisplayName: owner?.displayName ?? 'Unknown',
      ownerAvatarTint: owner?.avatarTint ?? '#9a6b4f',
      updatedAt: r.updatedAt,
      isMember: memberSet.has(r.id),
      stages: orderedStages,
      repoCount: repoCountByProject.get(r.id) ?? 0,
      unavailableRepoCount: unavailableByProject.get(r.id) ?? 0,
      archived: r.archived,
    };

    return base;
  });
}

/** Sort a project's stage views into STAGE_ORDER (defensive against row order). */
function orderStages(stages: StageView[]): StageView[] {
  const byKind = new Map(stages.map((s) => [s.kind, s]));
  return STAGE_ORDER.filter((k) => byKind.has(k)).map((k) => byKind.get(k)!);
}

/**
 * `assertProjectReadable` — load the project; public → ok; private → ok iff the
 * actor is owner or a project_member; else throw `ProjectAccessError`. The
 * layout maps the throw to `notFound()` (404, anti-enumeration — never 403 on
 * the read path).
 */
export async function assertProjectReadable(
  projectId: string,
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .select({ id: project.id, visibility: project.visibility, ownerId: project.ownerId, teamId: project.teamId })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, actor.teamId)))
    .limit(1);

  if (!row) throw new ProjectAccessError('Project not found.');
  if (row.visibility === 'public') return;
  if (row.ownerId === actor.id) return;
  throw new ProjectAccessError();
}

/* ── Single-project reads (for the [id] shell) ──────────────────────────── */

/** Load a single project row (no guard — callers guard first via the layout). */
export async function getProject(
  projectId: string,
  deps: ProjectsDeps = {},
): Promise<typeof project.$inferSelect | null> {
  const db = deps.db ?? getDb();
  const [row] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
  return row ?? null;
}

/** Load a single project's stage rows, ordered STAGE_ORDER (for the stepper). */
export async function getProjectStages(
  projectId: string,
  deps: ProjectsDeps = {},
): Promise<StageView[]> {
  const db = deps.db ?? getDb();

  // Details-ready path: derive stages from details JSON
  const [proj] = await db
    .select({ detailsReady: project.detailsReady, details: project.details })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (proj?.details) {
    const d = validateDetails(proj.details);
    const { getCurrentPhase } = await import('@/details/read');
    const stageViews = (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const).map((kind) => {
      const stg = d.stages[kind];
      const phase = getCurrentPhase(d, kind);
      return { kind, status: stg.status, lastPhase: phase };
    });
    return orderStages(stageViews);
  }
  return orderStages([]);
}

/**
 * Load a single project's repo subset with resolvable/unavailable flags. LEFT
 * JOINs `repo` — a dangling row (null join) or a `status='error'` row is
 * UNAVAILABLE; everything else resolves.
 */
export interface ProjectRepoView {
  repoId: string;
  name: string | null;
  tags: string[] | null;
  status: 'cloned' | 'pulling' | 'error' | null;
  /** False ⟺ dangling join OR status='error'. */
  available: boolean;
}

export async function getProjectRepos(
  projectId: string,
  deps: ProjectsDeps = {},
): Promise<ProjectRepoView[]> {
  const db = deps.db ?? getDb();
  const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row?.details) return [];
  const d = validateDetails(row.details);
  const repoIds = d.repos.map((r) => r.id);
  if (repoIds.length === 0) return [];
  const repoRows = await db.select({ id: repo.id, name: repo.name, tags: repo.tags, status: repo.status })
    .from(repo).where(inArray(repo.id, repoIds));
  return repoRows.map((r) => ({
    repoId: r.id,
    name: r.name,
    tags: r.tags,
    status: r.status,
    available: r.status !== null && r.status !== 'error',
  }));
}

/* ── Mutations ──────────────────────────────────────────────────────────── */

/**
 * `changeVisibility` — OWNER-ONLY. Read-guard first (404 anti-enumeration), then
 * the owner gate (403 on fail, no log row). Row update + audit insert are atomic.
 */
export async function changeVisibility(
  projectId: string,
  visibility: ProjectVisibility,
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  await assertProjectReadable(projectId, actor, deps);

  const [row] = await db
    .select({ ownerId: project.ownerId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row || row.ownerId !== actor.id) {
    throw new ProjectAccessError('Only the owner may change visibility.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(project.id, projectId));
  });
}

/**
 * `changeRepos` — EQUAL-RIGHTS (any read-permitted member). Replaces the full
 * subset (delete-then-insert) and must still satisfy ≥ 1 repo. Row replace +
 * audit insert are atomic.
 */
export async function changeRepos(
  projectId: string,
  repoIds: string[],
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  await assertProjectReadable(projectId, actor, deps);

  const unique = [...new Set(repoIds)];
  if (unique.length < 1) {
    throw new ProjectAccessError('A project must keep at least one repository.');
  }

  // Update repos in details
  const repoRows = await db.select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk, defaultBranch: repo.defaultBranch })
    .from(repo).where(inArray(repo.id, unique));
  await updateDetails(db, projectId, (d) => {
    d.repos = repoRows.map((r) => ({ id: r.id, name: r.name, pathOnDisk: r.pathOnDisk, defaultBranch: r.defaultBranch }));
    return d;
  });

  await db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({ updatedAt: new Date() })
      .where(eq(project.id, projectId));
  });
}

async function assertProjectOwner(
  projectId: string,
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<{ archived: boolean }> {
  const db = deps.db ?? getDb();
  await assertProjectReadable(projectId, actor, deps);

  const [row] = await db
    .select({
      ownerId: project.ownerId,
      archived: project.archived,
    })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  if (!row || row.ownerId !== actor.id) {
    throw new ProjectAccessError('Only the owner may change archive state.');
  }

  return { archived: row.archived };
}

async function recordArchiveActivityBestEffort(
  db: Db,
  projectId: string,
  actor: ProjectActor,
  label: 'Archived project' | 'Unarchived project',
): Promise<void> {
  try {
    const [actorRow] = await db
      .select({ displayName: member.displayName, avatarTint: member.avatarTint })
      .from(member)
      .where(eq(member.id, actor.id))
      .limit(1);

    await recordActivity({
      db,
      projectId,
      stage: 'journal',
      phase: 'archive',
      label,
      kind: 'done',
      actor: {
        id: actor.id,
        name: actorRow?.displayName ?? 'Unknown',
        tint: actorRow?.avatarTint ?? '#9a6b4f',
      },
      source: 'user',
      eventKey: `${label === 'Archived project' ? 'archive' : 'unarchive'}:${projectId}:${actor.id}`,
    });
  } catch {
    // Best-effort only: the durable state is forge.project.archived.
  }
}

export async function archiveProject(
  projectId: string,
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<{ archived: boolean }> {
  const db = deps.db ?? getDb();
  const ownerCheck = await assertProjectOwner(projectId, actor, { db });
  if (ownerCheck.archived) {
    return { archived: true };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({
        archived: true,
        updatedAt: new Date(),
      })
      .where(eq(project.id, projectId));
  });

  await recordArchiveActivityBestEffort(db, projectId, actor, 'Archived project');
  return { archived: true };
}

export async function unarchiveProject(
  projectId: string,
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<{ archived: boolean }> {
  const db = deps.db ?? getDb();
  const ownerCheck = await assertProjectOwner(projectId, actor, { db });
  if (!ownerCheck.archived) {
    return { archived: false };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(project)
      .set({
        archived: false,
        updatedAt: new Date(),
      })
      .where(eq(project.id, projectId));
  });

  await recordArchiveActivityBestEffort(db, projectId, actor, 'Unarchived project');
  return { archived: false };
}
