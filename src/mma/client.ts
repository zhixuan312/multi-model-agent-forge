/**
 * MmaClient core (Spec 2 §7.3 / `lib/mma/client.ts`).
 *
 * Server-side HTTP client for the co-located `mmagent` daemon. This slice ships
 * the generic spine only — `dispatch` / `poll` / `health` / `status` /
 * `dispatchAndWait`. Route-typed rod methods (audit / investigate / …) land with
 * their consuming specs.
 *
 * Auth/header contract (verified against MMA `caller-identity.ts`):
 *   - `Authorization: Bearer <token>` on tool routes + `/status` + `/batch/:id`;
 *     NEVER on `/health` (unauthenticated liveness).
 *   - `X-MMA-Client: forge` (MMA allowlist maps unknown → `other`; harmless).
 *   - `X-MMA-Main-Model: <main-tier model>` when present (tool routes require it;
 *     harmless on health/status).
 *
 * The bearer token is NEVER logged and is scrubbed from any error text
 * (Spec §Secret-redaction NFR F15). Every request is bounded by an
 * `AbortController` (`MMA_FETCH_TIMEOUT`, default 10s — F16).
 */

/** Config the client is constructed from (resolved server-side per request). */
import type { ConfigureProviderRequest, ConfigureProviderResponse } from '@/mma/configure-provider';

export interface MmaClientConfig {
  /** team_settings.mma_base_url; app-layer fallback http://127.0.0.1:7337. */
  baseUrl: string;
  /** Resolved bearer (decrypted from mma_token_ref / dev token file). */
  token: string;
  /** agent_tier(main).model → X-MMA-Main-Model; null when the main tier is unset. */
  mainModel: string | null;
}

/** Injectable seams (tests pass a fetch stub + fast timers). */
export interface MmaClientOptions {
  fetchImpl?: typeof fetch;
  /** Per-request abort ceiling. Default `MMA_FETCH_TIMEOUT` env or 10_000ms. */
  timeoutMs?: number;
  /** dispatchAndWait poll cadence. Default 1000ms. */
  pollIntervalMs?: number;
  /** dispatchAndWait overall wait ceiling. Default 15 minutes. */
  waitTimeoutMs?: number;
  /**
   * X-MMA-Client value. Default `forge` (Spec §11 resolution). The CURRENT
   * server rejects unknown clients with `400 client_required` on TOOL routes
   * (only the allowlist `claude-code|cursor|codex-cli|gemini-cli` is accepted —
   * `forge` resolves to `other` and is rejected). `health`/`status` are NOT tool
   * routes and accept `forge`. Until MMA adds `forge` to its allowlist, set
   * `MMA_CLIENT` (env) to an allowlisted value so tool dispatches work; this seam
   * keeps the spec's `forge` default while letting a deployment interoperate.
   */
  client?: string;
}

/** /health, normalized: `unreachable` folds fetch error/timeout/non-2xx. */
export type HealthResult =
  | { status: 'ok' }
  | { status: 'drift'; drift: unknown[] }
  | { status: 'unreachable' };

/** /status (Bearer), normalized for the deep token badge + drain snapshot. */
export interface StatusResult {
  reachable: boolean;
  /** false ⟺ /status returned 401 (the wrong-token signal). */
  authValid: boolean;
  version: string | null;
  pid: number | null;
  uptimeMs: number | null;
  activeBatches: number | null;
}

/** /batch/:id poll — discriminated on pending-headline vs terminal-envelope. */
export type BatchPollResult =
  | { state: 'pending'; headline: string }
  | { state: 'terminal'; envelope: unknown };

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60_000;

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
    this.client = opts.client ?? process.env.MMA_CLIENT?.trim() ?? 'forge';
  }

  /** Trim a trailing slash so `${base}/path` never doubles up. */
  private url(path: string): string {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  /** Headers for authenticated routes (tool dispatch / batch / status). */
  private authedHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.token}`,
      'X-MMA-Client': this.client,
      ...extra,
    };
    if (this.cfg.mainModel) h['X-MMA-Main-Model'] = this.cfg.mainModel;
    return h;
  }

  /** A single fetch bounded by an AbortController. Token never appears in errors. */
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
   * Route-name → unified task type mapping. Converts Forge's hyphenated route
   * names to the underscore-based TaskType enum used by `POST /task`.
   */
  private routeToTaskType(route: string): string {
    const MAP: Record<string, string> = {
      'investigate': 'investigate',
      'research': 'research',
      'audit': 'audit',
      'delegate': 'delegate',
      'execute-plan': 'execute_plan',
      'review': 'review',
      'debug': 'debug',
      'journal-record': 'journal_record',
      'journal-recall': 'journal_recall',
      'orchestrate': 'main',
    };
    return MAP[route] ?? route;
  }

  /**
   * Generic dispatch: `POST /task?cwd=<path>` with `{ type, ...body }`.
   * Returns `{ batchId }` (mapped from `taskId`) from the 202 body.
   */
  async dispatch(
    route: string,
    args: { cwd: string; body: unknown },
  ): Promise<{ batchId: string }> {
    const taskType = this.routeToTaskType(route);
    const url = `${this.url('/task')}?cwd=${encodeURIComponent(args.cwd)}`;
    const payload = { type: taskType, ...(args.body as Record<string, unknown> ?? {}) };
    let res: Response;
    try {
      res = await this.timedFetch(url, {
        method: 'POST',
        headers: this.authedHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error(`MMA dispatch to /task (${taskType}) failed (network error or timeout)`);
    }
    if (res.status !== 202) {
      throw new Error(`MMA dispatch to /task (${taskType}) failed with HTTP ${res.status}`);
    }
    const json = (await res.json().catch(() => null)) as { taskId?: string; batchId?: string } | null;
    const id = json?.taskId ?? json?.batchId;
    if (!id) {
      throw new Error(`MMA dispatch to /task (${taskType}) returned no taskId`);
    }
    return { batchId: id };
  }

  /**
   * Poll one task: `GET /task/:id`. MMA returns `202 text/plain` (running
   * headline) while pending and `200 application/json` (terminal envelope)
   * when complete/failed. Discriminated by status + content-type.
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
    const ctype = res.headers.get('content-type') ?? '';
    if (res.status === 202 || ctype.includes('text/plain')) {
      const headline = await res.text().catch(() => '');
      return { state: 'pending', headline };
    }
    if (res.status === 200 && ctype.includes('application/json')) {
      const envelope = await res.json().catch(() => null);
      return { state: 'terminal', envelope };
    }
    throw new Error(`MMA poll of task ${batchId} returned HTTP ${res.status}`);
  }

  /** GET /health (UNAUTHENTICATED). Folds any failure to `unreachable`. */
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

  /**
   * GET /status (Bearer + loopback). The sole place a wrong bearer surfaces (401
   * → authValid:false). Returns the four fields this slice consumes; the rest of
   * the live response is ignored.
   */
  async status(): Promise<StatusResult> {
    let res: Response;
    try {
      res = await this.timedFetch(this.url('/status'), {
        method: 'GET',
        headers: this.authedHeaders(),
      });
    } catch {
      return { reachable: false, authValid: false, version: null, pid: null, uptimeMs: null, activeBatches: null };
    }
    if (res.status === 401 || res.status === 403) {
      return { reachable: true, authValid: false, version: null, pid: null, uptimeMs: null, activeBatches: null };
    }
    if (!res.ok) {
      return { reachable: true, authValid: false, version: null, pid: null, uptimeMs: null, activeBatches: null };
    }
    const json = (await res.json().catch(() => null)) as
      | { version?: string; pid?: number; uptimeMs?: number; counters?: { activeBatches?: number } }
      | null;
    return {
      reachable: true,
      authValid: true,
      version: json?.version ?? null,
      pid: typeof json?.pid === 'number' ? json.pid : null,
      uptimeMs: typeof json?.uptimeMs === 'number' ? json.uptimeMs : null,
      activeBatches: typeof json?.counters?.activeBatches === 'number' ? json.counters.activeBatches : null,
    };
  }

  /**
   * POST /configure-provider — validate (dryRun:true) or validate+apply
   * (dryRun:false) a tier's provider/model/auth against the live MMA runtime.
   * mmagent owns the validation ladder + the in-memory hot-swap; Forge only
   * relays. Returns the result envelope verbatim; throws on a transport/HTTP error.
   */
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

  /* ── Exploration rod methods (Spec 5) ─────────────────────────────────────
   * Three READ routes. Each builds the route-specific strict body (verified
   * against MMA `tools/<route>/schema.ts`) and dispatches → 202 → { batchId }.
   * The caller (exploration/dispatch.ts) owns the `mma_batch` row + task link +
   * PollManager registration; these methods are the thin wire layer only.
   * Bodies are validated against the per-route MMA min-lengths BEFORE the POST,
   * so a sub-floor prompt fails fast in Forge rather than 400-ing at MMA. */

  /**
   * `POST /investigate?cwd=<repo path>`. Strict body
   * `{ question, subtype?, filePaths?, contextBlockIds?, tools? }`. `question`
   * has a ≥1 floor (no practical limit).
   */
  async investigate(
    cwd: string,
    input: {
      question: string;
      subtype?: 'default';
      filePaths?: string[];
      contextBlockIds?: string[];
      tools?: 'none' | 'readonly';
    },
  ): Promise<{ batchId: string }> {
    const question = input.question.trim();
    if (question.length < 1) {
      throw new Error('investigate.question must be at least 1 character');
    }
    const body: Record<string, unknown> = { question };
    if (input.subtype) body.subtype = input.subtype;
    if (input.filePaths) body.filePaths = input.filePaths;
    if (input.contextBlockIds) body.contextBlockIds = input.contextBlockIds;
    if (input.tools) body.tools = input.tools;
    return this.dispatch('investigate', { cwd, body });
  }

  /**
   * `POST /research?cwd=<workspace root>`. Sends EXACTLY
   * `{ researchQuestion, background, contextBlockIds?, subtype? }` — MMA blocks
   * `agentType`/`tools` and rejects unknown keys. Both text fields have a ≥20
   * floor.
   */
  async research(
    cwd: string,
    input: {
      researchQuestion: string;
      background: string;
      contextBlockIds?: string[];
      subtype?: 'default';
    },
  ): Promise<{ batchId: string }> {
    const researchQuestion = input.researchQuestion.trim();
    const background = input.background.trim();
    if (researchQuestion.length < 20) {
      throw new Error('research.researchQuestion must be at least 20 characters');
    }
    if (background.length < 20) {
      throw new Error('research.background must be at least 20 characters');
    }
    const body: Record<string, unknown> = { researchQuestion, background };
    if (input.contextBlockIds) body.contextBlockIds = input.contextBlockIds;
    if (input.subtype) body.subtype = input.subtype;
    return this.dispatch('research', { cwd, body });
  }

  /**
   * `POST /journal-recall?cwd=<workspace root>`. Strict body `{ query }` with a
   * ≥10 floor (the team journal lives at the workspace-root `.mmagent/journal/`).
   */
  async journalRecall(
    cwd: string,
    input: { query: string; contextBlockIds?: string[] },
  ): Promise<{ batchId: string }> {
    const query = input.query.trim();
    if (query.length < 10) {
      throw new Error('journalRecall.query must be at least 10 characters');
    }
    const body: Record<string, unknown> = { query };
    if (input.contextBlockIds) body.contextBlockIds = input.contextBlockIds;
    return this.dispatch('journal-recall', { cwd, body });
  }

  /* ── Build rod methods (Spec 7) ───────────────────────────────────────────
   * Three routes the build pipeline consumes: `audit(subtype='plan')` (READ,
   * plan-audit loop), `execute-plan` (WRITE, the high-trust path), `review`
   * (READ, advisory verdict). Each builds the route-specific strict body
   * (verified against MMA `tools/<route>/{tool-config,schema}.ts`) and dispatches
   * → 202 → { batchId }. The caller (src/build/*) owns the mma_batch row + poll
   * registration; these methods are the thin wire layer + the fast-fail floor. */

  /**
   * `POST /audit?cwd=<repo>` with `subtype:'plan'`. MMA's `.refine` REQUIRES
   * exactly one `filePaths` entry for `subtype=plan` (the plan markdown). The
   * worker discovers/verifies source files itself — never pre-list source.
   */
  async auditPlan(
    cwd: string,
    input: { filePaths: [string]; contextBlockIds?: string[] },
  ): Promise<{ batchId: string }> {
    if (!Array.isArray(input.filePaths) || input.filePaths.length !== 1) {
      throw new Error('auditPlan requires exactly one filePaths entry (the plan markdown)');
    }
    const body: Record<string, unknown> = { subtype: 'plan', filePaths: input.filePaths };
    if (input.contextBlockIds && input.contextBlockIds.length > 0) {
      body.contextBlockIds = input.contextBlockIds;
    }
    return this.dispatch('audit', { cwd, body });
  }

  /**
   * `POST /execute-plan?cwd=<repo>`. Strict body
   * `{ filePaths:[planFile] (length 1), taskDescriptors (min 1),
   *    perTaskReviewPolicy?: Record<string,'full'|'quality_only'|'diff_only'|'none'>,
   *    contextBlockIds? }`. Forge passes ONE taskDescriptor per dispatch
   * (sequential within a repo) and keys `perTaskReviewPolicy` by index-in-batch
   * (always `"0"`). `filePaths` MUST be the on-disk plan file under the cwd.
   */
  async executePlan(
    cwd: string,
    input: {
      filePaths: [string];
      taskDescriptors: string[];
      perTaskReviewPolicy?: Record<string, 'full' | 'quality_only' | 'diff_only' | 'none'>;
      contextBlockIds?: string[];
    },
  ): Promise<{ batchId: string }> {
    if (!Array.isArray(input.filePaths) || input.filePaths.length !== 1) {
      throw new Error('executePlan requires exactly one filePaths entry (the on-disk plan file)');
    }
    if (!Array.isArray(input.taskDescriptors) || input.taskDescriptors.length < 1) {
      throw new Error('executePlan requires at least one taskDescriptor');
    }
    const body: Record<string, unknown> = {
      filePaths: input.filePaths,
      taskDescriptors: input.taskDescriptors,
    };
    if (input.perTaskReviewPolicy) body.perTaskReviewPolicy = input.perTaskReviewPolicy;
    if (input.contextBlockIds && input.contextBlockIds.length > 0) {
      body.contextBlockIds = input.contextBlockIds;
    }
    return this.dispatch('execute-plan', { cwd, body });
  }

  /**
   * `POST /review?cwd=<repo>`. Strict body
   * `{ code?, focus?: ('security'|'performance'|'correctness'|'style')[],
   *    subtype:'default', filePaths?, contextBlockIds? }`. MMA returns FINDINGS,
   * not a verdict — Forge derives the binary verdict (≥1 critical/high →
   * changes_required) from `structuredReport`. Pass either `filePaths` or `code`.
   */
  async review(
    cwd: string,
    input: {
      filePaths?: string[];
      code?: string;
      focus?: ('security' | 'performance' | 'correctness' | 'style')[];
      contextBlockIds?: string[];
    },
  ): Promise<{ batchId: string }> {
    if ((!input.filePaths || input.filePaths.length === 0) && !input.code) {
      throw new Error('review requires either filePaths or inline code');
    }
    const body: Record<string, unknown> = { subtype: 'default' };
    if (input.filePaths && input.filePaths.length > 0) body.filePaths = input.filePaths;
    if (input.code) body.code = input.code;
    if (input.focus && input.focus.length > 0) body.focus = input.focus;
    if (input.contextBlockIds && input.contextBlockIds.length > 0) {
      body.contextBlockIds = input.contextBlockIds;
    }
    return this.dispatch('review', { cwd, body });
  }

  /** dispatch + poll-to-terminal. Returns the terminal envelope. */
  async dispatchAndWait(route: string, args: { cwd: string; body: unknown }): Promise<unknown> {
    const { batchId } = await this.dispatch(route, args);
    const deadline = Date.now() + this.waitTimeoutMs;
    for (;;) {
      const r = await this.poll(batchId);
      if (r.state === 'terminal') return r.envelope;
      if (Date.now() > deadline) {
        throw new Error(`MMA batch ${batchId} did not reach a terminal state before the wait timeout`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }
}
