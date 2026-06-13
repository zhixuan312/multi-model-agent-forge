import { findMockProject } from '@/mock/domains/projects/dashboard';

/**
 * Journal-stage mock (LEARN group). The final stop: harvest the learnings from
 * the run, curate which to keep, record them to the journal. Backed by MMA
 * journal-record in the real product; here the candidate learnings are static.
 */

/** `source` = which lifecycle stage the learning came out of (Manual = user-added). */
export const LEARNING_SOURCES = ['Exploration', 'Spec', 'Plan', 'Execute', 'Review', 'Journal', 'Manual'] as const;
export type LearningSource = (typeof LEARNING_SOURCES)[number];

/** `category` = what kind of learning it is (fixed taxonomy). */
export const LEARNING_CATEGORIES = ['decision', 'design', 'behavior', 'process', 'knowledge', 'style'] as const;
export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

/** One-line description of each category (shown in the journal summary). */
export const CATEGORY_DESC: Record<LearningCategory, string> = {
  decision: 'Technical trade-off outcomes — tried X, dropped it, use Y instead.',
  design: 'Architecture / pattern rationale — why things are built this way.',
  behavior: 'User interaction patterns, workflow preferences, communication style.',
  process: 'SDLC / workflow learnings — what works, what doesn’t, how phases operate.',
  knowledge: 'Factual findings from research / exploration — domain facts, API capabilities, ecosystem state.',
  style: 'Documentation conventions, code patterns, naming rules, writing norms.',
};

export interface Learning {
  id: string;
  num: number;
  text: string;
  tags: string[];
  source: LearningSource;
  category: LearningCategory;
}

// Learnings span the WHOLE run — every group/stage/phase, and not just technical:
// how the user works, usage patterns, doc style, exploration questions, design
// preferences, alongside the technical findings. Written like real journal
// entries: a grounded observation + the lesson, with concrete specifics.
const LEARNINGS: Learning[] = [
  {
    id: 'l1',
    num: 1,
    text: 'The 5·5·5 investigate/research/journal-recall fan-out surfaced the real problem — two execution engines (read criteria-loop vs write goal-engine) — inside one synthesis pass; an earlier single-thread dig missed it. Seed the brief from the fan-out, not a hand-typed prompt.',
    tags: ['exploration', 'fan-out'],
    source: 'Exploration',
    category: 'knowledge',
  },
  {
    id: 'l2',
    num: 2,
    text: 'On the type-registry vs per-handler call, the user asked “what would the team think” and converged via a product/tech/security panel. They reason through panels on architecture + naming — offer one proactively there.',
    tags: ['decision-making', 'panel'],
    source: 'Exploration',
    category: 'behavior',
  },
  {
    id: 'l3',
    num: 3,
    text: 'A prose-heavy first spec draft got rejected; the engineer-facing one with a product/technical split and TDD-shaped tasks stuck. Default specs to that shape — terse, structured, zero placeholders.',
    tags: ['docs', 'spec'],
    source: 'Spec',
    category: 'style',
  },
  {
    id: 'l4',
    num: 4,
    text: 'Treated a `done_with_concerns` + critical as a failure and over-corrected the pipeline; the user pushed back — findings are advisory. Surface them, don’t gate on them, and don’t read a concern as a trust alarm.',
    tags: ['audit', 'gating'],
    source: 'Spec',
    category: 'process',
  },
  {
    id: 'l5',
    num: 5,
    text: 'reviewPolicy had four values (full / quality_only / diff_only / none) but real calls only ever used reviewed and none — collapsed to two. Audit enums for middle values that never appear in practice.',
    tags: ['api', 'simplification'],
    source: 'Spec',
    category: 'decision',
  },
  {
    id: 'l6',
    num: 6,
    text: 'Collapsing the per-criterion read loop into one goal prompt is simpler but drops prefix caching — left unmeasured it could cost more than the loop it replaced. Estimate the token delta before trading caching for simplicity.',
    tags: ['perf', 'caching'],
    source: 'Plan',
    category: 'decision',
  },
  {
    id: 'l7',
    num: 7,
    text: 'The plan deleted the batch system in Phase 4 but only regenerated goldens in Phase 6 — the suite was red across two phases with no checkpoint. Put a green checkpoint immediately after any delete-before-rewrite cutover.',
    tags: ['sequencing', 'ci'],
    source: 'Plan',
    category: 'process',
  },
  {
    id: 'l8',
    num: 8,
    text: 'Task 6 shipped a session-id test asserting `true === true` — it passes review but proves nothing. Make a genuinely failing test step 1 of every task, or the TDD claim is hollow.',
    tags: ['tdd', 'tests'],
    source: 'Plan',
    category: 'process',
  },
  {
    id: 'l9',
    num: 9,
    text: 'Write tasks are isolated one-per-git-worktree, run sequentially: two write tasks committing in one cwd once raced the shared index and corrupted the tree. Verify against the real `git diff` — never the worker’s self-report.',
    tags: ['worktree', 'concurrency'],
    source: 'Execute',
    category: 'design',
  },
  {
    id: 'l10',
    num: 10,
    text: 'worktree-manager.ts interpolated the path into `git worktree add` unquoted — a repo path with a space broke it, and it’s an injection vector. Shell-quote every interpolated path and add a path-with-spaces test.',
    tags: ['security', 'shell'],
    source: 'Review',
    category: 'style',
  },
  {
    id: 'l11',
    num: 11,
    text: 'The user iterates UI design-first: edit, screenshot, adjust — and only wants build + tests + commit batched once satisfied. Committing or running tests mid-iteration drew a correction. Hold the batch to the end unless asked.',
    tags: ['workflow', 'ui'],
    source: 'Spec',
    category: 'behavior',
  },
  {
    id: 'l12',
    num: 12,
    text: 'The user runs MMA fully automated but expects a Stop-and-take-over at every gate, and the baton to pass cleanly mid-run (the locked-plan freeze that blocked the Build hand-off was a bug they caught immediately). Autonomy with an interrupt, never hands-off.',
    tags: ['automation', 'human-in-the-loop'],
    source: 'Execute',
    category: 'behavior',
  },
  {
    id: 'l13',
    num: 13,
    text: 'Approve-then-detail and lock-then-continue both got flagged as a redundant second click — approving IS moving on, locking IS proceeding. Make every stage gate single-click; the second click reads as friction.',
    tags: ['ux', 'gates'],
    source: 'Plan',
    category: 'behavior',
  },
];

export function mockJournal(projectId: string): { projectName: string; learnings: Learning[] } {
  const proj = findMockProject(projectId);
  return { projectName: proj?.name ?? 'Unified Task API', learnings: LEARNINGS };
}
