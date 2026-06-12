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
    'Map how reads currently route to the primary, and where region-aware selection would slot in.',
    'Identify which read paths are read-after-write and must bypass replicas.',
    'Trace the connection-pool / data-access layer to find the single seam for replica selection.',
    'Inventory PII-bearing tables that can’t replicate to ap-south under the residency rule.',
    'Find existing health-check / failover hooks we can reuse for replica liveness.',
  ],
  research: [
    'Survey how Vitess, CockroachDB, and Aurora do region-aware read routing.',
    'Compare app-layer vs DNS-based vs proxy-based read routing trade-offs.',
    'Research replication-lag measurement and per-query lag-budget patterns.',
    'Find prior art on cutting cross-region egress cost (stream compression, batching).',
    'Review data-residency approaches for per-region replica scoping.',
  ],
  journal: [
    'Recall prior decisions on replication-lag tolerance and read-after-write handling.',
    'Recall any past failover-routing learnings and what didn’t work.',
    'Recall decisions about where data-access / connection-pool logic should live.',
    'Recall prior cost analyses on cross-region traffic.',
    'Recall residency / compliance constraints recorded for ap-south.',
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
  investigate: 'Reading the data-access layer…',
  research: 'Comparing region-aware routing approaches…',
  journal: 'Scanning past replication decisions…',
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

Reads from **eu-west** and **ap-south** hit the single **us-east** primary at 180–400 ms p95. We want region-local read replicas without breaking read-after-write guarantees or data-residency rules, while cutting cross-region egress cost.

## What the codebase shows

- All reads route through one connection pool (\`data-access/pool.ts\`) — a single clean seam to add region-aware replica selection.
- The checkout path reads immediately after its write; these must stay pinned to the primary (read-after-write).
- PII-bearing tables (\`users\`, \`payment_methods\`) carry a residency tag that forbids replication into ap-south.
- Existing health-check hooks (\`infra/health.ts\`) can be reused for replica liveness.

## External precedent

- Vitess and CockroachDB both favour **app-layer, lag-aware** routing over DNS/proxy approaches when read-after-write matters.
- A per-query **lag budget** (e.g. ≤ 2 s staleness) is the common control for "may this read use a replica?".
- Egress cost drops most from replication-stream compression + batching, not from query-path changes.

## Prior decisions (journal)

- Proxy-based routing was previously rejected — operational opacity during failover.
- The connection pool is the agreed home for data-access concerns.
- A 2 s replication-lag tolerance was accepted for non-checkout reads.

## Recommended direction

1. Add **app-layer replica selection** at the pool seam, gated by a per-query lag budget.
2. Pin read-after-write paths (checkout) to the primary explicitly.
3. Scope replicas per region; exclude residency-tagged tables from ap-south.
4. Reduce egress with compressed, batched replication streams.

## Open questions for Spec

- The exact lag-budget threshold per read class.
- Failover when a regional replica is unhealthy — fall back to primary or nearest replica?
- Whether residency tagging is complete enough to drive replica scoping automatically.
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
