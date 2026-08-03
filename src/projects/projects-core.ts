/**
 * Projects core (Spec 3) — the data-layer owner of project create / list / get,
 * the visibility guard, and the mutations. Dependency-injected (`Db`) so route
 * handlers + the server action stay thin and the core unit-tests against the
 * live DB.
 *
 * Visibility: `visibleProjects` and `assertProjectReadable` gate WORK ARTIFACTS
 * (Q&A, drafts, plan, history) — NOT code/repos (those are team-public, Spec 2).
 * Every project-scoped artifact/stage/qa read routes through the guard; reads of
 * the repos themselves intentionally do not.
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
import { slugRefComponent } from '@/build/slug';
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
  /** One row per stage, in STAGE_ORDER. */
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
 * Is another project in this team already using the branch slug this name would produce?
 *
 * Uniqueness is evaluated on the SLUG, not on the raw or case-folded name, because the slug is
 * what actually becomes the branch. `slugRefComponent` maps every character outside
 * `[a-z0-9._-]` to `-` and collapses repeats, so "My Project", "My  Project" and "My/Project"
 * are three distinct names — all of which pass a `lower(name)` comparison — that collide on the
 * single branch `mma/<date>-my-project`. Comparing anything weaker than the slug would let two
 * projects silently share one branch and interleave their commits.
 *
 * `exceptId` excludes the project being renamed, so re-casing a project's own name is a no-op
 * rather than a conflict with itself.
 */
async function branchSlugTaken(db: Db, name: string, teamId: string, exceptId?: string): Promise<boolean> {
  const target = slugRefComponent(name);
  if (!target) return false;
  const rows = await db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(eq(project.teamId, teamId));
  return rows.some((r) => r.id !== exceptId && slugRefComponent(r.name ?? '') === target);
}

/**
 * Create a project + seed the stage skeleton (one per STAGE_ORDER entry) + repo subset + owner row +
 * its `Created project` activity row — ALL in one transaction (a partial failure
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
    // CHECK the reported path against the fields the client knows how to highlight, rather
    // than asserting with `as never`. Zod can report an issue on any path; the cast claimed
    // it was always one of these five, so an issue on anything else would have been handed
    // to the client as a field name it cannot resolve.
    const KNOWN_FIELDS = ['name', 'repoIds', 'visibility', 'selectedDesignStages', 'artifact'] as const;
    const field = KNOWN_FIELDS.find((f) => f === issue?.path[0]);
    return {
      ok: false,
      error: {
        field,
        message: issue?.message ?? 'Invalid input.',
      },
    };
  }

  const { name, visibility, repoIds, selectedDesignStages, uploadedArtifact } = parsed.data;
  const subsetValidation = validateSubsetSelection(selectedDesignStages as DesignStageSelection[]);
  if (!subsetValidation.ok) {
    return { ok: false, error: { field: 'selectedDesignStages', message: subsetValidation.message } };
  }

  // Project branches are `mma/<created-date>-<project-slug>` with no disambiguating id, so the
  // slug must be unique or two projects would share one branch. Checked before any write.
  if (await branchSlugTaken(deps.db ?? getDb(), name, actor.teamId)) {
    return {
      ok: false,
      error: {
        field: 'name',
        message: `Another project in this team already uses the branch name "${slugRefComponent(name)}". Pick a distinguishable name.`,
      },
    };
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
      const uniqueRepoIds = [...new Set(repoIds)];
      const repos = await tx
        .select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk, defaultBranch: repo.defaultBranch })
        .from(repo)
        .where(and(inArray(repo.id, uniqueRepoIds), eq(repo.teamId, actor.teamId)));
      if (repos.length !== uniqueRepoIds.length) {
        throw new ProjectAccessError('One or more repositories do not belong to your team.');
      }
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
  const repoIdsByProject = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.details) continue;
    try {
      const d = validateDetails(r.details);
      const stages = STAGE_ORDER.map((kind) => ({
        kind,
        status: d.stages[kind].status,
      }));
      stagesByProject.set(r.id, stages);
      repoIdsByProject.set(r.id, d.repos.map((x) => x.id));
      derivedByProject.set(r.id, deriveStageAndPhase(d));
    } catch {
      // ignore invalid details rows; preserve current behavior
    }
  }

  // A project's `details.repos` is a SNAPSHOT taken when the repo was linked; the repo row
  // can since have been deleted or gone to `status: 'error'`. Resolve them against the live
  // table so the card can say so — `unavailableRepoCount` was previously never written, so
  // it was always 0 and the "repo unavailable" chip could not appear however broken the
  // project was; `repoCount` counted the snapshot, dangling entries included, despite
  // documenting itself as resolvable-only. One batched query for every project on the page.
  const allRepoIds = [...new Set([...repoIdsByProject.values()].flat())];
  const healthyRepoIds = new Set<string>();
  if (allRepoIds.length > 0) {
    const repoRows = await db
      .select({ id: repo.id, status: repo.status })
      .from(repo)
      .where(and(inArray(repo.id, allRepoIds), eq(repo.teamId, actor.teamId)));
    for (const rr of repoRows) {
      if (rr.status !== 'error') healthyRepoIds.add(rr.id);
    }
  }
  for (const [projectId, ids] of repoIdsByProject) {
    const healthy = ids.filter((id) => healthyRepoIds.has(id)).length;
    repoCountByProject.set(projectId, healthy);
    unavailableByProject.set(projectId, ids.length - healthy);
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
    const stageViews = STAGE_ORDER.map((kind) => {
      const stg = d.stages[kind];
      const phase = getCurrentPhase(d, kind);
      return { kind, status: stg.status, lastPhase: phase };
    });
    return orderStages(stageViews);
  }
  return orderStages([]);
}

/* ── Mutations ──────────────────────────────────────────────────────────── */

/**
 * `changeVisibility` — OWNER-ONLY. Read-guard first (404 anti-enumeration), then
 * the owner gate (403 on fail, no log row).
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

  await db
    .update(project)
    .set({ visibility, updatedAt: new Date() })
    .where(eq(project.id, projectId));
}

/**
 * `changeRepos` — EQUAL-RIGHTS (any read-permitted member). Replaces the full
 * subset in `details` and must still satisfy ≥ 1 repo.
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

  // Update repos in details. Constrain to the actor's team and reject if any id
  // isn't theirs — otherwise a member could PATCH another team's repo UUID in and
  // bind its on-disk path (execute/review then run git against that foreign repo).
  const repoRows = await db.select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk, defaultBranch: repo.defaultBranch })
    .from(repo).where(and(inArray(repo.id, unique), eq(repo.teamId, actor.teamId)));
  if (repoRows.length !== unique.length) {
    throw new ProjectAccessError('One or more repositories do not belong to your team.');
  }
  await updateDetails(db, projectId, (d) => {
    d.repos = repoRows.map((r) => ({ id: r.id, name: r.name, pathOnDisk: r.pathOnDisk, defaultBranch: r.defaultBranch }));
    return d;
  });

  await db
    .update(project)
    .set({ updatedAt: new Date() })
    .where(eq(project.id, projectId));
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

  await db
    .update(project)
    .set({
      archived: true,
      updatedAt: new Date(),
    })
    .where(eq(project.id, projectId));

  await releaseProjectWorktrees(db, projectId);
  await recordArchiveActivityBestEffort(db, projectId, actor, 'Archived project');
  return { archived: true };
}

/**
 * Reclaim the per-repo checkouts an archived project was holding. Unlike a loop run's
 * worktree — torn down at the end of the run — a project's must survive execute → review →
 * fix → PR, which can span days, so archiving is the first point at which it is certainly
 * finished with. Best-effort and non-fatal: the BRANCH and any open PR are untouched, so a
 * failure here costs disk, never work, and unarchiving simply recreates the checkout on the
 * next execute.
 */
async function releaseProjectWorktrees(db: Db, projectId: string): Promise<void> {
  try {
    const [row] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
    if (!row?.details) return;
    const { removeProjectWorktree } = await import('@/build/project-worktree');
    for (const r of validateDetails(row.details).repos) {
      await removeProjectWorktree({ repoPathOnDisk: r.pathOnDisk, projectId });
    }
  } catch (err) {
    console.error(`[forge] could not release worktrees for archived project ${projectId}:`, err);
  }
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

  await db
    .update(project)
    .set({
      archived: false,
      updatedAt: new Date(),
    })
    .where(eq(project.id, projectId));

  await recordArchiveActivityBestEffort(db, projectId, actor, 'Unarchived project');
  return { archived: false };
}
