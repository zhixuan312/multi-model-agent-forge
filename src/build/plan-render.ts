import type { PlanDraft, PlanTaskDraft } from '@/build/plan-schema';

/**
 * Pure plan-rendering + validation (Spec 7 §Plan authoring). No DB, no fs, no
 * LLM. Renders the per-repo plan markdown (verbatim ATX headings = task
 * descriptors), enforces the no-git-commit-steps lint, validates the structured
 * output (known repos, no dep cycle), and computes the write/read split.
 */

/** The three banned tokens — a worker self-commit empties the diff (team learning, F5). */
const BANNED_TOKENS = ['git commit', 'git add', 'git push'];

export class PlanAuthorError extends Error {
  readonly reason:
    | 'empty_tasks'
    | 'unknown_repo'
    | 'dep_cycle'
    | 'git_commit_step'
    | 'duplicate_title';
  constructor(
    reason: PlanAuthorError['reason'],
    message: string,
  ) {
    super(message);
    this.name = 'PlanAuthorError';
    this.reason = reason;
  }
}

/** A validated, repo-resolved task ready to persist + render. `dependsOn` here are TITLES. */
export interface ResolvedTask {
  title: string;
  detail: string;
  targetRepoId: string;
  dependsOnTitles: string[];
  reviewPolicy: 'reviewed' | 'none';
  orderIndex: number;
}

/** Reject a task body that contains any of the three git-commit tokens (F5). */
export function lintNoCommitSteps(task: Pick<PlanTaskDraft, 'title' | 'detail'>): void {
  const haystack = `${task.title}\n${task.detail}`.toLowerCase();
  for (const tok of BANNED_TOKENS) {
    if (haystack.includes(tok)) {
      throw new PlanAuthorError(
        'git_commit_step',
        `Plan task "${task.title}" contains a git step ("${tok}"). Plans describe code changes only — MMA owns the commit.`,
      );
    }
  }
}

/**
 * Validate the raw structured output against the project's repo set + dependency
 * sanity, run the no-commit lint on every task, and return resolved tasks (with
 * a stable `orderIndex` from the draft order). Throws `PlanAuthorError` with a
 * `reason` on any violation — the caller maps `reason` to `plan.failed`.
 */
export function validateAndResolve(
  draft: PlanDraft,
  knownRepoIds: Set<string>,
): ResolvedTask[] {
  if (!draft.tasks || draft.tasks.length === 0) {
    throw new PlanAuthorError('empty_tasks', 'The authored plan has no tasks.');
  }

  const titles = draft.tasks.map((t) => t.title.trim());
  const titleSet = new Set<string>();
  for (const t of titles) {
    if (titleSet.has(t)) {
      throw new PlanAuthorError('duplicate_title', `Duplicate task title "${t}" — ATX headings must be unique.`);
    }
    titleSet.add(t);
  }

  for (const t of draft.tasks) {
    lintNoCommitSteps(t);
    if (!knownRepoIds.has(t.targetRepoId)) {
      throw new PlanAuthorError('unknown_repo', `Task "${t.title}" targets unknown repo "${t.targetRepoId}".`);
    }
    for (const dep of t.dependsOn) {
      if (!titleSet.has(dep.trim())) {
        throw new PlanAuthorError('dep_cycle', `Task "${t.title}" depends on unknown task "${dep}".`);
      }
    }
  }

  const resolved: ResolvedTask[] = draft.tasks.map((t, i) => ({
    title: t.title.trim(),
    detail: t.detail,
    targetRepoId: t.targetRepoId,
    dependsOnTitles: t.dependsOn.map((d) => d.trim()),
    reviewPolicy: t.reviewPolicy,
    orderIndex: i,
  }));

  assertNoCycle(resolved);
  return resolved;
}

/** Topological cycle check over the title-keyed dependency graph (F: dep cycle). */
function assertNoCycle(tasks: ResolvedTask[]): void {
  const byTitle = new Map(tasks.map((t) => [t.title, t]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(tasks.map((t) => [t.title, WHITE]));

  const visit = (title: string): void => {
    if (color.get(title) === BLACK) return;
    if (color.get(title) === GRAY) {
      throw new PlanAuthorError('dep_cycle', `Dependency cycle detected at task "${title}".`);
    }
    color.set(title, GRAY);
    for (const dep of byTitle.get(title)?.dependsOnTitles ?? []) {
      if (byTitle.has(dep)) visit(dep);
    }
    color.set(title, BLACK);
  };

  for (const t of tasks) visit(t.title);
}

/**
 * Render ONE repo's plan markdown: every task as a `### Task N: <title>`
 * heading followed by its detail prose. Uses `###` (h3) so repo grouping
 * can use `##` and the plan title uses `#` — matching superpowers plan format.
 */
export function renderRepoPlan(tasks: ResolvedTask[]): string {
  const lines: string[] = [];
  tasks.forEach((t, i) => {
    if (i > 0) lines.push('');
    lines.push(`### ${t.title}`);
    lines.push('');
    lines.push(t.detail.trim());
  });
  return lines.join('\n') + '\n';
}

/**
 * Render the COMBINED plan (all repos). Tasks grouped under `## <repo-name>`.
 * Heading hierarchy: `# Plan Title` → `## Repo` → `### Task` — matching
 * the superpowers writing-plans format.
 */
export function renderCombinedPlan(
  groups: Array<{ repoName: string; tasks: ResolvedTask[] }>,
): string {
  const out: string[] = [];
  groups.forEach((g, gi) => {
    if (gi > 0) out.push('');
    if (groups.length > 1) {
      out.push(`## ${g.repoName}`);
      out.push('');
    }
    out.push(renderRepoPlan(g.tasks).trimEnd());
  });
  return out.join('\n') + '\n';
}
