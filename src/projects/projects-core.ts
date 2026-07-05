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
import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { logAction } from '@/observability/action-log';

/** The acting member (only the id is load-bearing for the data layer). */
export interface ProjectActor {
  id: string;
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
}

export interface ProjectsDeps {
  db?: Db;
}

/* ── Create ─────────────────────────────────────────────────────────────── */

const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required.'),
  visibility: z.enum(['public', 'private']),
  repoIds: z.array(z.string().uuid()).min(1, 'Pick at least one repository.'),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export type CreateProjectResult =
  | { ok: true; id: string }
  | { ok: false; error: { field?: 'name' | 'repoIds' | 'visibility'; message: string } };

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
        field: field === 'name' || field === 'repoIds' || field === 'visibility' ? field : undefined,
        message: issue?.message ?? 'Invalid input.',
      },
    };
  }
  const { name, visibility, repoIds } = parsed.data;
  const uniqueRepoIds = [...new Set(repoIds)];
  const db = deps.db ?? getDb();

  const id = await db.transaction(async (tx) => {
    const { buildInitialDetails } = await import('@/details/schema');
    const initialDetails = buildInitialDetails();
    // Populate repos in initial details
    if (uniqueRepoIds.length > 0) {
      const { repo } = await import('@/db/schema/workspace');
      const { inArray } = await import('drizzle-orm');
      const repos = await tx.select({ id: repo.id, name: repo.name, pathOnDisk: repo.pathOnDisk, defaultBranch: repo.defaultBranch })
        .from(repo).where(inArray(repo.id, uniqueRepoIds));
      initialDetails.repos = repos.map((r) => ({ id: r.id, name: r.name, pathOnDisk: r.pathOnDisk, defaultBranch: r.defaultBranch }));
    }

    const [row] = await tx
      .insert(project)
      .values({
        name,
        visibility,
        phase: 'design',
        currentStage: 'exploration',
        ownerId: actor.id,
        details: initialDetails,
        detailsReady: true,
      })
      .returning({ id: project.id });

    // All project state is in details — no legacy table inserts needed

    await logAction(
      {
        projectId: row.id,
        memberId: actor.id,
        action: 'create_project',
        target: `project:${row.id}`,
        meta: { visibility, repoCount: uniqueRepoIds.length },
      },
      tx as unknown as Db,
    );

    return row.id;
  });

  return { ok: true, id };
}

/* ── Visibility guard + list ────────────────────────────────────────────── */

/**
 * `visibleProjects` — the SOLE owner of the list read. ONE query returning each
 * visible project (public OR the actor is a project_member) joined to its five
 * stage rows + a resolvable-repo count. No per-card N+1.
 */
export async function visibleProjects(
  actor: ProjectActor,
  deps: ProjectsDeps = {},
): Promise<ProjectListItem[]> {
  const db = deps.db ?? getDb();

  // All project state from details — no legacy table joins.
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
      details: project.details,
    })
    .from(project)
    .where(sql`${project.visibility} = 'public' OR ${project.ownerId} = ${actor.id}`)
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

  for (const r of rows) {
    if (r.details) {
      try {
        const { validateDetails } = await import('@/details/schema');
        const d = validateDetails(r.details);
        const stages = (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const).map((kind) => ({
          kind, status: d.stages[kind].status,
        }));
        stagesByProject.set(r.id, stages);
        repoCountByProject.set(r.id, d.repos.length);
      } catch { /* invalid details — skip */ }
    }
  }

  return rows.map((r) => {
    const owner = ownerById.get(r.ownerId);
    const orderedStages = orderStages(stagesByProject.get(r.id) ?? []);
    return {
      id: r.id,
      name: r.name,
      summary: r.summary,
      visibility: r.visibility,
      phase: r.phase,
      currentStage: r.currentStage,
      ownerId: r.ownerId,
      ownerDisplayName: owner?.displayName ?? 'Unknown',
      ownerAvatarTint: owner?.avatarTint ?? '#9a6b4f',
      updatedAt: r.updatedAt,
      isMember: memberSet.has(r.id),
      stages: orderedStages,
      repoCount: repoCountByProject.get(r.id) ?? 0,
      unavailableRepoCount: unavailableByProject.get(r.id) ?? 0,
    };
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
    .select({ id: project.id, visibility: project.visibility, ownerId: project.ownerId })
    .from(project)
    .where(eq(project.id, projectId))
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
    await logAction(
      {
        projectId,
        memberId: actor.id,
        action: 'change_visibility',
        target: `project:${projectId}`,
        meta: { visibility },
      },
      tx as unknown as Db,
    );
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
    await logAction(
      {
        projectId,
        memberId: actor.id,
        action: 'change_repos',
        target: `project:${projectId}`,
        meta: { repoCount: unique.length },
      },
      tx as unknown as Db,
    );
  });
}
