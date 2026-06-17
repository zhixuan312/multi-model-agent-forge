import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { planTask } from '@/db/schema/build';
import { projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { AnthropicClient } from '@/anthropic/client';
import { logAction } from '@/observability/action-log';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';
import { getLatestSpec } from '@/spec/assemble';
import { PlanDraftSchema, type PlanDraft } from '@/build/plan-schema';
import {
  validateAndResolve,
  renderRepoPlan,
  renderCombinedPlan,
  PlanAuthorError,
  type ResolvedTask,
} from '@/build/plan-render';
import { nodePlanFs, writePlanFile, type PlanFs } from '@/build/plan-fs';

/**
 * Plan authoring orchestrator (Spec 7 §Plan authoring; the 7a producer).
 *
 * Triggered when `project.phase` reaches `build`. Reads the frozen
 * `artifact(kind='spec')` + the project's repos, has the Anthropic main model
 * decompose a per-repo plan (one `targetRepoId` per task), validates atomically
 * (known repos, no dep cycle, no git-commit steps), writes each write-target
 * repo's plan markdown to `<repo>/.forge/plan-<id>.md`, persists `plan_task` rows
 * (queued) + a combined `artifact(kind='plan')`, and emits `plan.authored`.
 *
 * ATOMICITY (F30): the structured output is fully validated BEFORE any insert; a
 * validation/Anthropic failure emits `plan.failed` and inserts NO partial rows.
 * The plan files are written only after validation passes; a plan-file write
 * failure halts (no rows persisted) so execute never dispatches against a missing
 * file (F12).
 */

const SYSTEM_PROMPT = `You are the build-plan author for Forge, a software delivery harness.
Given a frozen technical spec and the set of repos in scope, produce an ordered list of implementation tasks.

HARD RULES:
- Each task targets EXACTLY ONE repo (its targetRepoId from the provided repo set). A unit of work spanning two repos is TWO tasks (one per repo), wired with dependsOn.
- Describe CODE CHANGES ONLY. NEVER include git add / git commit / git push steps — the harness owns the commit.
- Each task's title becomes a verbatim plan heading; keep titles unique and descriptive.
- reviewPolicy is 'full' for every task UNLESS the task is intentionally incomplete (downstream errors expected, fixed by a later task) — only then use 'none'.
- dependsOn lists sibling task titles (exact) that must complete first.`;

export interface PlanAuthorDeps {
  db?: Db;
  anthropic: AnthropicClient;
  fs?: PlanFs;
  bus?: ProjectEventBus;
  /** Inject a pre-built draft to bypass the LLM (tests). */
  draftOverride?: PlanDraft;
}

export interface PlanAuthorResult {
  ok: true;
  artifactId: string;
  version: number;
  taskCount: number;
  writeTargets: string[];
  readOnly: string[];
}

export interface PlanAuthorFailure {
  ok: false;
  reason: string;
}

interface RepoInfo {
  id: string;
  name: string;
  pathOnDisk: string;
  tags: string[];
  defaultBranch: string;
}

/** Load the project's repos (the candidate write/read set). */
async function loadProjectRepos(db: Db, projectId: string): Promise<RepoInfo[]> {
  return db
    .select({
      id: repo.id,
      name: repo.name,
      pathOnDisk: repo.pathOnDisk,
      tags: repo.tags,
      defaultBranch: repo.defaultBranch,
    })
    .from(projectRepo)
    .innerJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, projectId));
}

/** The next plan-artifact version (max existing + 1). */
async function nextPlanVersion(db: Db, projectId: string): Promise<number> {
  const [row] = await db
    .select({ m: sql<number>`coalesce(max(${artifact.version}), 0)` })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'plan')));
  return (row?.m ?? 0) + 1;
}

/**
 * Author the build plan. Returns `{ok:true,...}` on success or `{ok:false,reason}`
 * on a clean halt (the route surfaces it; `plan.failed` is emitted in both
 * failure paths). Throws only on truly unexpected errors.
 */
export async function authorPlan(
  deps: PlanAuthorDeps,
  args: { projectId: string; actorId: string },
): Promise<PlanAuthorResult | PlanAuthorFailure> {
  const db = deps.db ?? getDb();
  const fs = deps.fs ?? nodePlanFs;
  const bus = deps.bus ?? projectEventBus;
  const { projectId, actorId } = args;

  const repos = await loadProjectRepos(db, projectId);
  if (repos.length === 0) {
    return fail(bus, projectId, 'No repos in the project — nothing to plan.');
  }
  const reposById = new Map(repos.map((r) => [r.id, r]));

  const spec = await getLatestSpec(db, projectId);
  if (!spec) {
    return fail(bus, projectId, 'No frozen spec artifact to plan from.');
  }

  // 1. Author the structured plan (Anthropic main model) — or use the injected draft.
  let rawDraft: PlanDraft;
  try {
    if (deps.draftOverride) {
      rawDraft = deps.draftOverride;
    } else {
      const repoList = repos
        .map((r) => `- id=${r.id} name=${r.name} tags=${r.tags.join(',') || '—'}`)
        .join('\n');
      rawDraft = await deps.anthropic.parse(PlanDraftSchema, {
        call: 'authorPlan',
        projectId,
        system: SYSTEM_PROMPT,
        user: `Frozen spec:\n\n${spec.bodyMd}\n\nRepos in scope:\n${repoList}`,
      });
    }
  } catch {
    return fail(bus, projectId, 'The plan author (Anthropic) failed to produce a plan.');
  }

  // 2. Validate atomically (known repos, no cycle, no commit steps) BEFORE any write.
  let resolved: ResolvedTask[];
  try {
    resolved = validateAndResolve(rawDraft, new Set(reposById.keys()));
  } catch (err) {
    if (err instanceof PlanAuthorError) {
      return fail(bus, projectId, err.message);
    }
    throw err;
  }

  // 3. Group by repo → write/read split. A repo with ≥1 task is a write target.
  const byRepo = new Map<string, ResolvedTask[]>();
  for (const t of resolved) {
    const arr = byRepo.get(t.targetRepoId) ?? [];
    arr.push(t);
    byRepo.set(t.targetRepoId, arr);
  }
  const writeTargetIds = [...byRepo.keys()];
  const writeTargets = writeTargetIds.map((id) => reposById.get(id)!.name);
  const readOnly = repos.filter((r) => !byRepo.has(r.id)).map((r) => r.name);

  // 4. Write each write-target repo's plan file (under its cwd). A write failure
  //    halts BEFORE any DB insert / dispatch (F12).
  try {
    for (const [repoId, tasks] of byRepo) {
      const r = reposById.get(repoId)!;
      const md = renderRepoPlan([...tasks].sort((a, b) => a.orderIndex - b.orderIndex));
      await writePlanFile(fs, r.pathOnDisk, projectId, md);
    }
  } catch {
    return fail(bus, projectId, 'Failed to write a plan file to a repo — build halted before dispatch.');
  }

  // 5. Persist plan_task rows + the combined plan artifact, atomically.
  const combinedGroups = writeTargetIds.map((id) => ({
    repoName: reposById.get(id)!.name,
    tasks: [...byRepo.get(id)!].sort((a, b) => a.orderIndex - b.orderIndex),
  }));
  const combinedMd = renderCombinedPlan(combinedGroups);
  const version = await nextPlanVersion(db, projectId);

  const { artifactId, tasks } = await db.transaction(async (tx) => {
    const [art] = await tx
      .insert(artifact)
      .values({ projectId, kind: 'plan', bodyMd: combinedMd, version, createdBy: null })
      .returning({ id: artifact.id });

    // Insert tasks; dependsOn (titles) → resolved to ids after all rows exist.
    const titleToId = new Map<string, string>();
    const inserted: Array<{ id: string; title: string; repoId: string; reviewPolicy: string }> = [];
    for (const t of resolved) {
      const [row] = await tx
        .insert(planTask)
        .values({
          projectId,
          title: t.title,
          detail: t.detail,
          targetRepoId: t.targetRepoId,
          isWrite: true,
          orderIndex: t.orderIndex,
          reviewPolicy: t.reviewPolicy,
          status: 'queued',
        })
        .returning({ id: planTask.id });
      titleToId.set(t.title, row.id);
      inserted.push({ id: row.id, title: t.title, repoId: t.targetRepoId, reviewPolicy: t.reviewPolicy });
    }
    // Second pass: wire depends_on (title → id).
    for (const t of resolved) {
      if (t.dependsOnTitles.length === 0) continue;
      const ids = t.dependsOnTitles.map((d) => titleToId.get(d)!).filter(Boolean);
      await tx.update(planTask).set({ dependsOn: ids }).where(eq(planTask.id, titleToId.get(t.title)!));
    }

    await logAction(
      { projectId, memberId: actorId, action: 'author_plan', target: `artifact:${art.id}` },
      tx as unknown as Db,
    );
    return { artifactId: art.id, tasks: inserted };
  });

  bus.publish(projectId, {
    type: 'plan.authored',
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      repo: reposById.get(t.repoId)!.name,
      reviewPolicy: t.reviewPolicy,
    })),
    writeTargets,
    readOnly,
  });

  return { ok: true, artifactId, version, taskCount: resolved.length, writeTargets, readOnly };
}

function fail(bus: ProjectEventBus, projectId: string, reason: string): PlanAuthorFailure {
  bus.publish(projectId, { type: 'plan.failed', reason });
  return { ok: false, reason };
}

/* ── Reads for the Plan pane ─────────────────────────────────────────────── */

/** The latest plan artifact (combined plan md) for a project, or null. */
export async function getLatestPlanArtifact(db: Db, projectId: string) {
  const dbi = db ?? getDb();
  const [row] = await dbi
    .select()
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'plan')))
    .orderBy(desc(artifact.version))
    .limit(1);
  return row ?? null;
}

/** All plan_task rows for a project (ordered), joined with repo name for the UI. */
export async function loadPlanTasks(db: Db, projectId: string) {
  const dbi = db ?? getDb();
  return dbi
    .select({
      id: planTask.id,
      title: planTask.title,
      detail: planTask.detail,
      targetRepoId: planTask.targetRepoId,
      repoName: repo.name,
      dependsOn: planTask.dependsOn,
      orderIndex: planTask.orderIndex,
      reviewPolicy: planTask.reviewPolicy,
      status: planTask.status,
      branch: planTask.branch,
      commitSha: planTask.commitSha,
      fixNote: planTask.fixNote,
      meta: planTask.meta,
    })
    .from(planTask)
    .innerJoin(repo, eq(planTask.targetRepoId, repo.id))
    .where(eq(planTask.projectId, projectId))
    .orderBy(asc(planTask.orderIndex));
}
