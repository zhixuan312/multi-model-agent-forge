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

export const PLAN_AUTHOR_SYSTEM_PROMPT = `You are the build-plan author for Forge, a software delivery harness.
Given a frozen technical spec and the set of repos in scope, decompose the spec into an ordered list of bite-sized, test-first implementation tasks.

The engineer executing this plan has ZERO context about the codebase. Every task must be self-contained — they should be able to execute it by reading the task alone, without referring to other tasks or exploring the codebase.

TASK DESIGN PRINCIPLES:

1. TDD — every task follows this cycle:
   - Write a FAILING test (show the actual test code)
   - Run it to confirm it fails (name the expected error)
   - Write the MINIMAL implementation (show the actual code)
   - Run it to confirm it passes
   The detail field must include the actual code for both the test and the implementation — not descriptions of what to write.

2. Bite-sized — each task is 2-15 minutes of focused work. One interface, one function, one behavior. If a task has more than 3 files or takes longer, split it.

3. Exact file paths — every task lists files to Create, Modify, or Test with exact paths and line ranges where applicable (e.g. "Modify: src/routes/claims.ts:80-95").

4. Actual code — the detail field must contain:
   - The complete type/interface definitions (not "define a type with these fields")
   - The complete function signatures (not "write a function that does X")
   - The complete test assertions (not "assert it returns the right shape")
   Show the code in fenced code blocks. The engineer copies and pastes — they do not invent.

5. No placeholders — these are plan FAILURES:
   - "Add appropriate error handling"
   - "Implement the logic"
   - "Write tests for the above"
   - "Similar to Task N" (repeat the code)
   Every step must have the actual content.

6. Edge cases — for each function/adapter, include test cases for:
   - Empty input (no filters, no rows, empty arrays)
   - Null/undefined fields
   - Boundary values (0 results, 1 result, max pagination)
   Name specific edge cases in the test code.

7. Spec coverage — before finalizing, verify:
   - Every acceptance criterion in the spec has at least one task covering it
   - Every success metric has a task that proves it
   - Non-functional requirements (fail-fast, observability, config defaults) each have a task
   If a spec requirement has no task, add one.

TASK FORMAT (JSON array):
Each task object has:
- title: unique, descriptive (e.g. "Define ClaimsRepository port and ClaimRow type")
- detail: full task body in markdown with this structure:

  **Files:**
  - Create: \`exact/path/to/file.ts\`
  - Modify: \`exact/path/to/existing.ts:10-25\`
  - Test: \`tests/exact/path/to/test.ts\`

  **Test (write first):**
  \`\`\`typescript
  // the actual test code the engineer writes
  \`\`\`

  **Implementation:**
  \`\`\`typescript
  // the actual code that makes the test pass
  \`\`\`

  **Run:** \`npm test -- tests/path/test.ts\`
  **Expected:** PASS

- targetRepoId: the ONE repo (from the provided set)
- dependsOn: array of sibling task titles (exact match) that must complete first. Empty if none.
- reviewPolicy: "reviewed" normally. "none" ONLY when intentionally incomplete (downstream task fixes errors).

HARD RULES:
- Each task targets EXACTLY ONE repo. Cross-repo work = separate tasks wired with dependsOn.
- NEVER include git add / commit / push — the harness owns commits.
- Order by dependency: a task's dependsOn titles must appear earlier in the list.
- Aim for 8-20 tasks. Each independently testable.
- Include actual TypeScript/JavaScript code in the detail — not pseudocode or descriptions.

OUTPUT FORMAT:
Return ONLY a JSON array inside a markdown code fence. No wrapper object. No commentary before or after.

\`\`\`json
[
  { "title": "...", "detail": "...", "targetRepoId": "...", "dependsOn": [], "reviewPolicy": "full" }
]
\`\`\``;

export interface PlanAuthorDeps {
  db?: Db;
  anthropic?: AnthropicClient;
  fs?: PlanFs;
  bus?: ProjectEventBus;
  /** Inject a pre-built draft to bypass the LLM (tests + dispatch handler). */
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
      if (!deps.anthropic) return fail(bus, projectId, 'No Anthropic client and no draft override.');
      rawDraft = await deps.anthropic.parse(PlanDraftSchema, {
        call: 'authorPlan',
        projectId,
        system: PLAN_AUTHOR_SYSTEM_PROMPT,
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
