import { asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { planTask } from '@/db/schema/build';
import { projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { logAction } from '@/observability/action-log';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';
import { getLatestSpec } from '@/spec/assemble';
import { writePlanAsync, readPlanFileAsync } from '@/projects/project-files';
import type { PlanDraft } from '@/build/plan-schema';
import {
  validateAndResolve,
  renderRepoPlan,
  renderCombinedPlan,
  PlanAuthorError,
  type ResolvedTask,
} from '@/build/plan-render';
import { nodePlanFs, writePlanFile, type PlanFs } from '@/build/plan-fs';

/**
 * Plan authoring — validates a structured plan draft (from the MMA dispatch
 * handler), writes per-repo plan files + the combined `plan.md` physical file,
 * and persists `plan_task` rows. The LLM call happens in MMA via
 * `dispatchAndRegister` → `plan-author` handler; this module owns validation
 * and persistence only.
 */

export const PLAN_AUTHOR_SYSTEM_PROMPT = `Role: You are the build-plan author for Forge, a software delivery harness.

Task: Given a locked technical spec and the set of repos in scope, decompose the spec into an ordered list of bite-sized, test-first implementation tasks. The engineer executing this plan has ZERO context about the codebase — every task must be self-contained.

Constraints:

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

Output format (JSON array):
Each task object has:
- title: unique, descriptive (e.g. "Define ClaimsRepository port and ClaimRow type")
- detail: full task body in markdown following this exact structure:

  **Files:**
  - Create: \`exact/path/to/file.ts\`
  - Modify: \`exact/path/to/existing.ts:10-25\`
  - Test: \`tests/exact/path/to/test.ts\`

  - [ ] **Step 1: Write the failing test**

  \`\`\`typescript
  // the actual test code the engineer writes
  \`\`\`

  - [ ] **Step 2: Run test to verify it fails**

  Run: \`npm test -- tests/path/test.ts\`
  Expected: FAIL with "function not defined"

  - [ ] **Step 3: Write minimal implementation**

  \`\`\`typescript
  // the actual code that makes the test pass
  \`\`\`

  - [ ] **Step 4: Run test to verify it passes**

  Run: \`npm test -- tests/path/test.ts\`
  Expected: PASS

  - [ ] **Step 5: Commit**

  \`\`\`bash
  git add tests/path/test.ts src/path/file.ts
  \`\`\`

- phase: the track/phase this task belongs to (e.g. "Track A — Data layer", "Track B — API"). Group related tasks under the same phase. Use 2-4 phases for a typical plan.
- targetRepoId: the ONE repo (from the provided set)
- dependsOn: array of sibling task titles (exact match) that must complete first. Empty if none.
- reviewPolicy: "reviewed" normally. "none" ONLY when intentionally incomplete (downstream task fixes errors).

Hard rules:
- Each task targets EXACTLY ONE repo. Cross-repo work = separate tasks wired with dependsOn.
- NEVER include git add / commit / push steps in the plan as actionable work — the harness owns commits. The Step 5 commit line is a LABEL only (tells the harness what to stage).
- Order by dependency: a task's dependsOn titles must appear earlier in the list.
- Aim for 8-20 tasks. Each independently testable.
- Include actual TypeScript/JavaScript code in the detail — not pseudocode or descriptions.
- Use checkbox syntax (\`- [ ]\`) for every step — this enables progress tracking.

Return ONLY a JSON array inside a markdown code fence. No wrapper object. No commentary before or after.

\`\`\`json
[
  { "title": "...", "detail": "...", "phase": "Track A — ...", "targetRepoId": "...", "dependsOn": [], "reviewPolicy": "reviewed" }
]
\`\`\``;

export interface PlanAuthorDeps {
  db?: Db;
  fs?: PlanFs;
  bus?: ProjectEventBus;
  /** The structured plan draft (from MMA dispatch handler or test fixture). */
  draftOverride: PlanDraft;
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
    return fail(bus, projectId, 'No locked spec artifact to plan from.');
  }

  const rawDraft = deps.draftOverride;

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

  // 5. Write the combined plan to the physical plan.md file.
  const combinedGroups = writeTargetIds.map((id) => ({
    repoName: reposById.get(id)!.name,
    tasks: [...byRepo.get(id)!].sort((a, b) => a.orderIndex - b.orderIndex),
  }));
  const { project: projectTable } = await import('@/db/schema/projects');
  const [proj] = await db.select({ name: projectTable.name }).from(projectTable).where(eq(projectTable.id, projectId)).limit(1);
  const planHeader = [
    `# ${proj?.name ?? 'Project'} — Implementation Plan`,
    '',
    `**Goal:** Implement the locked specification across ${writeTargets.length} repo${writeTargets.length === 1 ? '' : 's'} in ${resolved.length} tasks.`,
    '',
    `**Repos:** ${writeTargets.join(', ')}`,
    '',
    '---',
    '',
  ].join('\n');
  const combinedMd = planHeader + renderCombinedPlan(combinedGroups);
  const { version } = await writePlanAsync(projectId, combinedMd);

  // 6. Persist plan_task rows.
  const tasks = await db.transaction(async (tx) => {
    const titleToId = new Map<string, string>();
    const inserted: Array<{ id: string; title: string; repoId: string; reviewPolicy: string }> = [];
    for (const t of resolved) {
      const [row] = await tx
        .insert(planTask)
        .values({
          projectId,
          title: t.title,
          detail: t.detail,
          phase: t.phase ?? null,
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
    for (const t of resolved) {
      if (t.dependsOnTitles.length === 0) continue;
      const ids = t.dependsOnTitles.map((d) => titleToId.get(d)!).filter(Boolean);
      await tx.update(planTask).set({ dependsOn: ids }).where(eq(planTask.id, titleToId.get(t.title)!));
    }

    await logAction(
      { projectId, memberId: actorId, action: 'author_plan', target: `plan:v${version}` },
      tx as unknown as Db,
    );
    return inserted;
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

  return { ok: true, artifactId: projectId, version, taskCount: resolved.length, writeTargets, readOnly };
}

function fail(bus: ProjectEventBus, projectId: string, reason: string): PlanAuthorFailure {
  bus.publish(projectId, { type: 'plan.failed', reason });
  return { ok: false, reason };
}

/* ── Reads for the Plan pane ─────────────────────────────────────────────── */

/** The latest plan from disk — file-based, not DB. */
export async function getLatestPlanArtifact(_db: unknown, projectId: string) {
  const file = await readPlanFileAsync(projectId);
  if (!file) return null;
  return { bodyMd: file.bodyMd, version: file.version };
}

/** Re-render the combined plan from DB tasks and write to the physical plan.md file. */
export async function reassemblePlan(db: Db, projectId: string): Promise<void> {
  const tasks = await loadPlanTasks(db, projectId);
  if (tasks.length === 0) return;
  const byRepo = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const arr = byRepo.get(t.repoName ?? '') ?? [];
    arr.push(t);
    byRepo.set(t.repoName ?? '', arr);
  }
  const groups = [...byRepo.entries()].map(([repoName, repoTasks]) => ({
    repoName,
    tasks: repoTasks.map((t) => ({
      title: t.title,
      detail: t.detail ?? '',
      targetRepoId: t.targetRepoId,
      dependsOnTitles: [] as string[],
      reviewPolicy: t.reviewPolicy as 'reviewed' | 'none',
      orderIndex: t.orderIndex,
    })),
  }));
  const { project: projectTable } = await import('@/db/schema/projects');
  const [proj] = await db.select({ name: projectTable.name }).from(projectTable).where(eq(projectTable.id, projectId)).limit(1);
  const repoNames = [...byRepo.keys()].filter(Boolean);
  const header = [
    `# ${proj?.name ?? 'Project'} — Implementation Plan`,
    '',
    `**Goal:** Implement the locked specification across ${repoNames.length} repo${repoNames.length === 1 ? '' : 's'} in ${tasks.length} tasks.`,
    '',
    `**Repos:** ${repoNames.join(', ')}`,
    '',
    '---',
    '',
  ].join('\n');
  const combinedMd = header + renderCombinedPlan(groups);
  await writePlanAsync(projectId, combinedMd);
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
