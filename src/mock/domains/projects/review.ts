import { mockPlan } from '@/mock/domains/projects/plan';
import type { ReviewUnit, ReviewFinding } from '@/build/review-types';

/**
 * Review-stage mock. After Execute lands the commits, MMA's code-review (or a
 * human) reviews the changeset. Server-only (mockPlan reads fs).
 */

const shaFor = (n: number) => ((n * 2654435761) >>> 0).toString(16).padStart(7, '0').slice(0, 7);

// Code-review findings — two passes: pass 1 has highs (revised), pass 2 clears to low (clean).
const REVIEW_ROUNDS: ReviewFinding[][] = [
  [
    { severity: 'high', category: 'correctness', claim: '`journal_record` is configured `sandbox: cwd-only`, but the read-types test asserts read-only — the registry and its test disagree.', location: 'packages/core/src/unified/type-registry.ts' },
    { severity: 'high', category: 'security', claim: 'The worktree path is interpolated into the shell command unquoted — a repo path with a space breaks `git worktree add` and risks injection.', location: 'packages/core/src/unified/worktree-manager.ts' },
    { severity: 'medium', category: 'error-handling', claim: 'On a reviewer parse failure the pipeline returns `done_with_concerns` but never surfaces `reviewerRaw` on the envelope, so the caller can’t see what failed.', location: 'packages/core/src/unified/two-phase-pipeline.ts' },
    { severity: 'medium', category: 'tests', claim: 'The cache-identity assertion uses `toBe` on the SkillPair reference — brittle if the loader ever clones the object.', location: 'tests/unified/skill-loader.test.ts' },
    { severity: 'low', category: 'style', claim: '`mustGet` throws a bare `Error`; a typed `TaskNotFoundError` would let callers branch on it.', location: 'packages/core/src/unified/task-registry.ts' },
  ],
  [{ severity: 'low', category: 'docs', claim: 'The POST /task handler lacks a doc comment for the enrichment-hook ordering (investigate → execute_plan → research).', location: 'packages/server/src/http/handlers/unified-task.ts' }],
];

export function mockReview(projectId: string): {
  projectName: string;
  mmaReady: boolean;
  units: ReviewUnit[];
  reviewRounds: ReviewFinding[][];
} {
  const plan = mockPlan(projectId);
  const units: ReviewUnit[] = plan.phases
    .flatMap((p) => p.tasks)
    .map((t) => ({
      id: t.id,
      num: t.num,
      title: t.title,
      repo: t.targetRepo,
      files: t.files,
      commit: shaFor(t.num),
    }));
  return { projectName: plan.projectName, mmaReady: plan.mmaReady, units, reviewRounds: REVIEW_ROUNDS };
}
