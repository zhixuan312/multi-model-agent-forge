/**
 * MmaClient — server-side HTTP client for the co-located `mma` daemon.
 *
 * Wire contract — the unified task API, matched to MMA `MATCHED_MMA_VERSION`
 * (see docs/mma-compatibility.md for the full capability-parity matrix):
 *   - POST /task?cwd=<path>  → 202 { taskId, statusUrl }
 *   - GET  /task/:id         → 202 { taskId, status:'running', phase, elapsedMs, ... }  (application/json)
 *                              → 200 { task, output, execution, metrics, raw, error }   (6-field layered envelope)
 *   - GET  /health           → 200 { status:'ok'|'drift' }              (unauthenticated)
 *   - GET  /status           → 200 { version, pid, counters:{activeTasks}, ... }  (Bearer)
 *   - POST /configure-provider → 200 { verified, applied, ... }         (Bearer)
 *
 * Auth: `Authorization: Bearer <token>` + `X-MMA-Client` + `X-MMA-Main-Model`.
 * The bearer token is NEVER logged.
 */

import type { ConfigureProviderRequest, ConfigureProviderResponse } from '@/mma/configure-provider';

type MmaAuthoringTarget =
  | { inline: string; paths?: never }
  | { paths: string[]; inline?: never };

function assertAuthoringTarget(
  route: 'spec' | 'plan',
  target: MmaAuthoringTarget,
): asserts target is MmaAuthoringTarget {
  const hasInline = typeof (target as { inline?: unknown }).inline === 'string';
  const hasPaths = Array.isArray((target as { paths?: unknown }).paths);
  if (hasInline === hasPaths) {
    throw new Error(`${route} requires exactly one target arm: { inline } or { paths }`);
  }
  if (hasInline && !(target as { inline: string }).inline.trim()) {
    throw new Error(`${route}.target.inline must be a non-empty string`);
  }
  if (hasPaths && !(target as { paths: string[] }).paths.length) {
    throw new Error(`${route}.target.paths must contain at least one path`);
  }
}

export interface MmaClientConfig {
  baseUrl: string;
  token: string;
  mainModel: string | null;
}

export interface MmaClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  client?: string;
}

export type HealthResult =
  | { status: 'ok' }
  | { status: 'drift'; drift: unknown[] }
  | { status: 'unreachable' };

export interface StatusResult {
  reachable: boolean;
  authValid: boolean;
  version: string | null;
  pid: number | null;
  uptimeMs: number | null;
  activeTasks: number | null;
}

/** MMA poll result — pending returns structured JSON, terminal returns the result envelope. */
export type BatchPollResult =
  | { state: 'pending'; headline: string; phase?: string; elapsedMs?: number; totalTasks?: number }
  | { state: 'terminal'; envelope: unknown }
  | { state: 'not_found' };

/** The new MMA terminal response shape (v5.4+). */
export interface MmaTerminalEnvelope {
  task: { taskId: string; type: string; subtype?: string; status: string };
  output: { summary: unknown; filesChanged: string[]; contextBlockId: string | null };
  execution: {
    sessions: { implementer: string; reviewer: string | null };
    worktree: { merged: boolean; branch: string; path?: string } | null;
  };
  metrics: {
    totalDurationMs: number;
    totalCostUsd: number;
    implementer: { durationMs: number; costUsd: number; usage: TokenUsage };
    reviewer: { durationMs: number; costUsd: number; usage: TokenUsage } | null;
    totalUsage: TokenUsage;
    mainEquivalentCostUsd: number | null;
    savedVsMainCostUsd: number | null;
  };
  raw: { implementer: string; reviewer: string | null };
  error: { code: string; message: string } | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedNonReadTokens: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
// 1 hour — matches PollManager's POLL_HARD_TIMEOUT_MS so a synchronously-awaited
// task has the same lifetime ceiling as an async-tracked one. A task still
// running before this is alive, not failed; don't declare it dead early.
const DEFAULT_WAIT_TIMEOUT_MS = 60 * 60_000;

function resolveFetchTimeout(opt?: number): number {
  if (typeof opt === 'number') return opt;
  const env = process.env.MMA_FETCH_TIMEOUT;
  const n = env ? Number(env) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FETCH_TIMEOUT_MS;
}

export class MmaClient {
  private readonly cfg: MmaClientConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly waitTimeoutMs: number;
  private readonly client: string;

  constructor(cfg: MmaClientConfig, opts: MmaClientOptions = {}) {
    this.cfg = cfg;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = resolveFetchTimeout(opts.timeoutMs);
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.client = opts.client ?? process.env.MMA_CLIENT?.trim() ?? 'claude-code';
  }

  private url(path: string): string {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private authedHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.token}`,
      'X-MMA-Client': this.client,
      ...extra,
    };
    if (this.cfg.mainModel) h['X-MMA-Main-Model'] = this.cfg.mainModel;
    return h;
  }

  private async timedFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Generic dispatch: `POST /task?cwd=<path>` with the full payload.
   * MMA returns 202 `{ taskId, statusUrl }`.
   */
  async dispatch(
    route: string,
    args: { cwd: string; body: unknown },
  ): Promise<{ batchId: string }> {
    const url = `${this.url('/task')}?cwd=${encodeURIComponent(args.cwd)}`;
    const payload = args.body as Record<string, unknown> ?? {};
    let res: Response;
    try {
      res = await this.timedFetch(url, {
        method: 'POST',
        headers: this.authedHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error(`MMA dispatch to /task (${route}) failed (network error or timeout)`);
    }
    if (res.status !== 202) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`MMA dispatch to /task (${route}) failed with HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }
    const json = (await res.json().catch(() => null)) as { taskId?: string } | null;
    if (!json?.taskId) {
      throw new Error(`MMA dispatch to /task (${route}) returned no taskId`);
    }
    return { batchId: json.taskId };
  }

  /**
   * Poll one task: `GET /task/:id`.
   * - 202 JSON: `{ taskId, status:'running', phase, elapsedMs, ... }` → pending
   * - 200 JSON: `{ task, output, execution, metrics, raw, error }` → terminal
   */
  async poll(batchId: string): Promise<BatchPollResult> {
    let res: Response;
    try {
      res = await this.timedFetch(this.url(`/task/${encodeURIComponent(batchId)}`), {
        method: 'GET',
        headers: this.authedHeaders(),
      });
    } catch {
      throw new Error(`MMA poll of task ${batchId} failed (network error or timeout)`);
    }
    if (res.status === 202) {
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return {
        state: 'pending',
        headline: String(json?.phase ?? 'running'),
        phase: json?.phase as string | undefined,
        elapsedMs: json?.elapsedMs as number | undefined,
        totalTasks: json?.totalTasks as number | undefined,
      };
    }
    if (res.status === 200) {
      const envelope = await res.json().catch(() => null);
      return { state: 'terminal', envelope };
    }
    if (res.status === 404) {
      return { state: 'not_found' as const };
    }
    throw new Error(`MMA poll of task ${batchId} returned HTTP ${res.status}`);
  }

  async health(): Promise<HealthResult> {
    try {
      const res = await this.timedFetch(this.url('/health'), { method: 'GET' });
      if (!res.ok) return { status: 'unreachable' };
      const json = (await res.json().catch(() => null)) as
        | { status?: string; drift?: unknown[] }
        | null;
      if (json?.status === 'ok') return { status: 'ok' };
      if (json?.status === 'drift') return { status: 'drift', drift: json.drift ?? [] };
      return { status: 'unreachable' };
    } catch {
      return { status: 'unreachable' };
    }
  }

  async status(): Promise<StatusResult> {
    let res: Response;
    try {
      res = await this.timedFetch(this.url('/status'), {
        method: 'GET',
        headers: this.authedHeaders(),
      });
    } catch {
      return { reachable: false, authValid: false, version: null, pid: null, uptimeMs: null, activeTasks: null };
    }
    if (res.status === 401 || res.status === 403) {
      return { reachable: true, authValid: false, version: null, pid: null, uptimeMs: null, activeTasks: null };
    }
    if (!res.ok) {
      return { reachable: true, authValid: false, version: null, pid: null, uptimeMs: null, activeTasks: null };
    }
    const json = (await res.json().catch(() => null)) as
      | { version?: string; pid?: number; uptimeMs?: number; counters?: { activeTasks?: number } }
      | null;
    return {
      reachable: true,
      authValid: true,
      version: json?.version ?? null,
      pid: typeof json?.pid === 'number' ? json.pid : null,
      uptimeMs: typeof json?.uptimeMs === 'number' ? json.uptimeMs : null,
      activeTasks: typeof json?.counters?.activeTasks === 'number' ? json.counters.activeTasks : null,
    };
  }

  async configureProvider(input: ConfigureProviderRequest): Promise<ConfigureProviderResponse> {
    let res: Response;
    try {
      res = await this.timedFetch(this.url('/configure-provider'), {
        method: 'POST',
        headers: this.authedHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(input),
      });
    } catch {
      throw new Error('MMA /configure-provider failed (network error or timeout)');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      throw new Error(
        `MMA /configure-provider failed with HTTP ${res.status}${body?.error?.code ? ` (${body.error.code})` : ''}`,
      );
    }
    return (await res.json()) as ConfigureProviderResponse;
  }

  /* ── Exploration rod methods ─────────────────────────────────────────────── */

  async investigate(
    cwd: string,
    input: {
      prompt: string;
      paths?: string[];
      contextBlockIds?: string[];
    },
  ): Promise<{ batchId: string }> {
    const prompt = input.prompt.trim();
    if (prompt.length < 1) {
      throw new Error('investigate.prompt must be at least 1 character');
    }
    const body: Record<string, unknown> = {
      type: 'investigate',
      prompt,
    };
    if (input.paths && input.paths.length > 0) {
      body.target = { paths: input.paths };
    }
    if (input.contextBlockIds) body.contextBlockIds = input.contextBlockIds;
    return this.dispatch('investigate', { cwd, body });
  }

  async research(
    cwd: string,
    input: {
      prompt: string;
      contextBlockIds?: string[];
    },
  ): Promise<{ batchId: string }> {
    const prompt = input.prompt.trim();
    if (prompt.length < 20) {
      throw new Error('research.prompt must be at least 20 characters');
    }
    const body: Record<string, unknown> = {
      type: 'research',
      prompt,
    };
    if (input.contextBlockIds) body.contextBlockIds = input.contextBlockIds;
    return this.dispatch('research', { cwd, body });
  }

  async journalRecall(
    cwd: string,
    input: { prompt: string; contextBlockIds?: string[] },
  ): Promise<{ batchId: string }> {
    const prompt = input.prompt.trim();
    if (prompt.length < 10) {
      throw new Error('journalRecall.prompt must be at least 10 characters');
    }
    const body: Record<string, unknown> = {
      type: 'journal_recall',
      prompt,
    };
    if (input.contextBlockIds) body.contextBlockIds = input.contextBlockIds;
    return this.dispatch('journal-recall', { cwd, body });
  }

  /* ── Build rod methods ───────────────────────────────────────────────────── */

  async auditPlan(
    cwd: string,
    input: { paths: [string]; contextBlockIds?: string[] },
  ): Promise<{ batchId: string }> {
    if (!Array.isArray(input.paths) || input.paths.length !== 1) {
      throw new Error('auditPlan requires exactly one paths entry (the plan markdown)');
    }
    const body: Record<string, unknown> = {
      type: 'audit',
      subtype: 'plan',
      target: { paths: input.paths },
    };
    if (input.contextBlockIds && input.contextBlockIds.length > 0) {
      body.contextBlockIds = input.contextBlockIds;
    }
    return this.dispatch('audit', { cwd, body });
  }

  /**
   * Audit a spec document. Uses `subtype: 'spec'` with `target.paths`.
   */
  async auditSpec(
    cwd: string,
    input: { paths: string[]; contextBlockIds?: string[] },
  ): Promise<{ batchId: string }> {
    const body: Record<string, unknown> = {
      type: 'audit',
      subtype: 'spec',
      target: { paths: input.paths },
    };
    if (input.contextBlockIds && input.contextBlockIds.length > 0) {
      body.contextBlockIds = input.contextBlockIds;
    }
    return this.dispatch('audit', { cwd, body });
  }

  /**
   * Audit with inline content (when target content is too large for fan-out).
   */
  async auditInline(
    cwd: string,
    input: { inline: string; subtype?: string; contextBlockIds?: string[] },
  ): Promise<{ batchId: string }> {
    const body: Record<string, unknown> = {
      type: 'audit',
      target: { inline: input.inline },
    };
    if (input.subtype) body.subtype = input.subtype;
    if (input.contextBlockIds && input.contextBlockIds.length > 0) {
      body.contextBlockIds = input.contextBlockIds;
    }
    return this.dispatch('audit', { cwd, body });
  }

  /**
   * Execute plan: send ALL tasks in one call. MMA handles matching + sequencing.
   * `target.paths` = the plan file; `tasks` = heading titles (empty = all).
   */
  async executePlan(
    cwd: string,
    input: {
      planPath: string;
      tasks?: string[];
      reviewPolicy?: 'reviewed' | 'none';
      contextBlockIds?: string[];
    },
  ): Promise<{ batchId: string }> {
    if (!input.planPath) {
      throw new Error('executePlan requires a planPath');
    }
    const body: Record<string, unknown> = {
      type: 'execute_plan',
      target: { paths: [input.planPath] },
      tasks: input.tasks ?? [],
    };
    if (input.reviewPolicy) body.reviewPolicy = input.reviewPolicy;
    if (input.contextBlockIds && input.contextBlockIds.length > 0) {
      body.contextBlockIds = input.contextBlockIds;
    }
    return this.dispatch('execute-plan', { cwd, body });
  }

  async review(
    cwd: string,
    input: {
      paths?: string[];
      inline?: string;
      prompt?: string;
      contextBlockIds?: string[];
    },
  ): Promise<{ batchId: string }> {
    if ((!input.paths || input.paths.length === 0) && !input.inline) {
      throw new Error('review requires either paths or inline code');
    }
    const target: Record<string, unknown> = {};
    if (input.paths && input.paths.length > 0) target.paths = input.paths;
    if (input.inline) target.inline = input.inline;
    const body: Record<string, unknown> = {
      type: 'review',
      target,
    };
    if (input.prompt) body.prompt = input.prompt;
    if (input.contextBlockIds && input.contextBlockIds.length > 0) {
      body.contextBlockIds = input.contextBlockIds;
    }
    return this.dispatch('review', { cwd, body });
  }

  async spec(
    cwd: string,
    input: { prompt: string; target: MmaAuthoringTarget; outputPath: string; components?: string[]; contextBlockIds?: string[] },
  ): Promise<{ batchId: string }> {
    assertAuthoringTarget('spec', input.target);
    if (!input.prompt.trim()) throw new Error('spec.prompt must be a non-empty string');
    if (!input.outputPath.trim()) throw new Error('spec.outputPath must be a non-empty string');
    const body: Record<string, unknown> = {
      type: 'spec',
      prompt: input.prompt,
      target: input.target,
      outputPath: input.outputPath,
    };
    // Subset support (mma-spec >=5.8.7): omit to draft all 8 components.
    if (input.components?.length) body.components = input.components;
    if (input.contextBlockIds?.length) body.contextBlockIds = input.contextBlockIds;
    return this.dispatch('spec', { cwd, body });
  }

  async plan(
    cwd: string,
    input: { prompt: string; target: MmaAuthoringTarget; outputPath: string; contextBlockIds?: string[] },
  ): Promise<{ batchId: string }> {
    assertAuthoringTarget('plan', input.target);
    if (!input.prompt.trim()) throw new Error('plan.prompt must be a non-empty string');
    if (!input.outputPath.trim()) throw new Error('plan.outputPath must be a non-empty string');
    const body: Record<string, unknown> = {
      type: 'plan',
      prompt: input.prompt,
      target: input.target,
      outputPath: input.outputPath,
    };
    if (input.contextBlockIds?.length) body.contextBlockIds = input.contextBlockIds;
    return this.dispatch('plan', { cwd, body });
  }

  /**
   * Dispatch a task and block until it reaches a terminal state. Returns BOTH the
   * MMA task id (`batchId`) — the same id used to poll — and the terminal
   * `envelope`. The caller persists `batchId` so a Forge `ops_mma_batch` row can
   * always be traced back to the MMA task in MMA's own logs/telemetry, even for
   * synchronous (await) dispatches that never register with the PollManager.
   */
  async dispatchAndWait(route: string, args: { cwd: string; body: unknown }): Promise<{ batchId: string; envelope: unknown }> {
    const { batchId } = await this.dispatch(route, args);
    const deadline = Date.now() + this.waitTimeoutMs;
    for (;;) {
      const r = await this.poll(batchId);
      if (r.state === 'terminal') return { batchId, envelope: r.envelope };
      if (r.state === 'not_found') {
        throw new Error(`MMA task ${batchId} no longer exists (404) — the server may have restarted.`);
      }
      if (Date.now() > deadline) {
        throw new Error(`MMA batch ${batchId} did not reach a terminal state before the wait timeout`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }
}
