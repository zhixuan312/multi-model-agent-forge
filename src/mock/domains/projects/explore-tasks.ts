import type { RailTask, ArtifactCacheEntry } from '@/hooks/useProjectEvents';

/**
 * Stateful mock for the Exploration fan-out (Spec 5). "Analyze sources" calls
 * `proposeMockTasks` which seeds a 5 · 5 · 5 fan-out (Investigate · Research ·
 * Journal recall) for the project; the client then refetches GET /tasks, which
 * reads this store. Per-process in-memory — ephemeral, which is exactly right for
 * a mock walk-through (re-analyze regenerates it).
 */
const STORE = new Map<string, RailTask[]>();

const REPO = 'mock-repo-mma'; // investigate tasks require a target repo

const PROMPTS: Record<'investigate' | 'research' | 'journal', string[]> = {
  investigate: [
    'Map the two current execution pipelines — the read-route criteria loop and the write-route goal engine — and where they diverge.',
    'Trace how `/delegate`, `/audit`, and the other per-route handlers compile input (briefSlot, tool-config) before dispatch.',
    'Find the batch system surface: batch-registry, batch-cache, and the `GET /batch/:id` endpoint to be removed.',
    'Identify how sessions are created/resumed today and whether session IDs are exposed by Claude/Codex.',
    'Locate the sandbox + worktree handling and how it keys off the read/write route distinction.',
  ],
  research: [
    'Survey two-tier implementer→reviewer agent patterns and the case for cross-tier (model-diversity) review.',
    'Compare goal-based single-prompt execution vs sequential per-criterion loops for read tasks.',
    'Research git-worktree isolation patterns for parallel agent file edits and cheap dependency installs.',
    'Review deterministic (non-LLM) result annotation: parsing git diffs + structured reviewer JSON.',
    'Find prior art on self-contained task APIs vs server-side multi-task batching.',
  ],
  journal: [
    'Recall why MMA split read vs write routes into two engines, and what that cost us.',
    'Recall prior decisions on review-as-default and the constitutional self-review blind spot (Principle 3).',
    'Recall any past learnings on session reuse limits across Claude vs Codex.',
    'Recall decisions about where type-specific behavior should live (skill files vs pipeline branching).',
    'Recall prior cost analyses on the annotate LLM-judge step.',
  ],
};

function draft(projectId: string, kind: string, n: number, prompt: string): RailTask {
  return {
    id: `mock-draft-${projectId}-${n}`,
    kind,
    status: 'draft',
    prompt,
    targetRepoId: kind === 'investigate' ? REPO : null,
    mmaBatchId: null,
    batchStatus: null,
    headline: null,
    error: null,
    outputMd: null,
  };
}

/** Seed (replace) the project's fan-out with a 5·5·5 proposal. */
export function proposeMockTasks(projectId: string): RailTask[] {
  const tasks: RailTask[] = [];
  let n = 0;
  for (const kind of ['investigate', 'research', 'journal'] as const) {
    for (const prompt of PROMPTS[kind]) tasks.push(draft(projectId, kind, ++n, prompt));
  }
  STORE.set(projectId, tasks);
  return tasks;
}

/** When a run was dispatched — used to advance `running` → `recorded` after a beat. */
const DISPATCH_AT = new Map<string, number>();
const RUN_DURATION_MS = 2400;

export function getMockTasks(projectId: string): RailTask[] {
  let list = STORE.get(projectId) ?? [];
  // Simulate the agents finishing: once enough time has elapsed since dispatch,
  // any still-running task flips to recorded (so the rail shows run → done).
  const at = DISPATCH_AT.get(projectId);
  if (at && Date.now() - at > RUN_DURATION_MS && list.some((t) => t.status === 'running')) {
    list = list.map((t) =>
      t.status === 'running' ? { ...t, status: 'recorded', batchStatus: 'done', headline: null } : t,
    );
    STORE.set(projectId, list);
  }
  return list;
}

/** Dispatch every draft → all agents start `running`; `getMockTasks` advances
 *  them to `recorded` after RUN_DURATION_MS so the rail shows run → finish. */
export function runMockTasks(projectId: string): RailTask[] {
  const list = STORE.get(projectId) ?? [];
  const ran = list.map((t, i) =>
    t.status === 'draft'
      ? {
          ...t,
          status: 'running',
          mmaBatchId: `mock-batch-${projectId}-${i}`,
          batchStatus: 'running',
          headline: RUNNING_HEADLINE[t.kind] ?? 'Working…',
        }
      : t,
  );
  STORE.set(projectId, ran);
  DISPATCH_AT.set(projectId, Date.now());
  return ran;
}

const RUNNING_HEADLINE: Record<string, string> = {
  investigate: 'Tracing the per-route handlers…',
  research: 'Comparing implementer/reviewer tier patterns…',
  journal: 'Scanning past pipeline decisions…',
};

/* ── Synthesis artifact ───────────────────────────────────────────────────── */

const ARTIFACT = new Map<string, ArtifactCacheEntry>();

/** Build (or re-build, bumping version) the synthesized exploration brief. */
export function synthesizeMock(projectId: string): ArtifactCacheEntry {
  const prev = ARTIFACT.get(projectId);
  const entry: ArtifactCacheEntry = {
    id: `mock-artifact-${projectId}`,
    version: (prev?.version ?? 0) + 1,
    bodyMd: SYNTH_MD,
  };
  ARTIFACT.set(projectId, entry);
  return entry;
}

export function getMockArtifact(projectId: string): ArtifactCacheEntry | null {
  return ARTIFACT.get(projectId) ?? null;
}

const SYNTH_MD = `## Problem

MMA runs **two** execution pipelines — a sequential criteria loop for read routes (audit, investigate, review, debug, research, journal) and a goal engine for write routes (delegate, execute_plan). Two engines violates Principle 7 ("rods are thin presets over one engine") and doubles the surface to maintain.

## What the codebase shows

- Per-route handlers each compile input via \`briefSlot()\` + per-tool \`tool-config.ts\` before dispatch — input shaping is duplicated.
- The batch system (\`batch-registry.ts\`, \`batch-cache.ts\`, \`GET /batch/:id\`) exists only for server-side multi-task fan-out the caller could do with N calls.
- \`ClaudeSession\` / \`CodexCliSession\` store session IDs privately — no getter to surface them for reuse.
- Sandbox + worktree behavior keys off a read/write route flag rather than the task type.

## External precedent

- Two-tier **implementer → reviewer** with the reviewer on the *opposite* tier maximizes model diversity (different failure modes catch more).
- A single **goal prompt** with the criteria encoded in a skill file replaces the per-criterion loop — simpler, at the cost of prefix caching.
- **git worktrees** give cheap parallel isolation for write tasks; deterministic annotate (git diff + structured JSON) avoids an LLM judge.

## Prior decisions (journal)

- Review-as-default is constitutional (Principle 3) — self-review has structural blind spots.
- Type-specific behavior should live in **skill files**, not pipeline branching.
- Codex sessions can't resume cross-phase; durable reuse is Claude-only.

## Recommended direction

1. One \`POST /task\` endpoint → a unified **implementer → reviewer → deterministic annotate** pipeline.
2. A flat **type registry** (default tier · worktree · sandbox) + per-type \`implement.md\` / \`review.md\` skill files.
3. Collapse \`reviewPolicy\` to \`reviewed | none\`; expose session IDs for opt-in multi-turn reuse.
4. Remove the batch system and the read/write engine split; worktree-isolate write types.

## Open questions for Spec

- Per-phase vs shared wall-clock budget (Phase 2 starvation).
- Structured output format for the implementer (not just the reviewer).
- The enrichment-hook contract for the 3 type-specific pre-dispatch functions.
`;

/** Remove one task (the card's × button). */
export function removeMockTask(projectId: string, taskId: string): void {
  STORE.set(projectId, (STORE.get(projectId) ?? []).filter((t) => t.id !== taskId));
}

/** Edit one draft's prompt / target repo (inline edit + repo select). */
export function patchMockTask(
  projectId: string,
  taskId: string,
  body: { prompt?: string; targetRepoId?: string | null },
): void {
  const list = STORE.get(projectId) ?? [];
  const next = list.map((t) =>
    t.id === taskId
      ? {
          ...t,
          ...(typeof body.prompt === 'string' ? { prompt: body.prompt } : {}),
          ...(body.targetRepoId !== undefined ? { targetRepoId: body.targetRepoId } : {}),
        }
      : t,
  );
  STORE.set(projectId, next);
}

/** Append one manually-added draft (the "+ add task" affordance). */
export function addMockTask(
  projectId: string,
  input: { kind: string; prompt: string; targetRepoId?: string | null },
  seq: number,
): RailTask {
  const list = STORE.get(projectId) ?? [];
  const task = draft(projectId, input.kind, 1000 + seq, input.prompt);
  task.targetRepoId = input.targetRepoId ?? (input.kind === 'investigate' ? REPO : null);
  list.push(task);
  STORE.set(projectId, list);
  return task;
}
