import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { agentTier, provider } from '@/db/schema/config';
import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';

/**
 * `AnthropicClient` (Spec 4 / lib/anthropic/client.ts) — the ONLY Anthropic
 * surface in the product. It wraps `@anthropic-ai/sdk` and exposes typed
 * structured-output calls via `messages.parse` + `zodOutputFormat` (Zod 4),
 * `claude-opus-4-8`, and adaptive thinking.
 *
 * The model + key come from the `main` agent tier (`agent_tier` row `tier='main'`
 * → `provider` → `api_key_ref`/`base_url`, resolved through the SecretStore);
 * fallback `ANTHROPIC_API_KEY` env. The key/token is NEVER logged. A clear typed
 * error is thrown when no key is configured.
 *
 * The class is pure/DI-testable: an SDK-like `messages` impl can be injected so
 * tests never call a real LLM.
 */

/** The model used when the `main` tier carries no explicit model (technical.md §7.2). */
export const DEFAULT_MAIN_MODEL = 'claude-opus-4-8';

/** Hard per-call ceiling (F18/F23). 120s — well above worst-case, below the SDK's ~10-min guard. */
export const ANTHROPIC_CALL_TIMEOUT_MS = 120_000;

/** SDK retry budget for the Q&A workload (F12) — raised from the SDK default of 2. */
export const ANTHROPIC_MAX_RETRIES = 4;

/** Base non-streaming `max_tokens` — sized for one section's drafted markdown. */
export const BASE_MAX_TOKENS = 16_000;

/** `draftSection`-only streaming retry ceiling on a `max_tokens` stop (F3/F18). */
export const DRAFT_RETRY_MAX_TOKENS = 32_000;

/** Thrown when the `main` tier has no resolvable API key (config-time precondition, F30). */
export class AnthropicConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnthropicConfigError';
  }
}

/**
 * Thrown when a `messages.parse` returns no `parsed_output` (refusal / max_tokens
 * / schema miss). Carries the `stop_reason` so the route handler can pick the
 * right neutral surface (refusal vs schema-miss vs max_tokens). The raw response
 * is NOT echoed to the browser.
 */
export class AnthropicParseError extends Error {
  readonly stopReason: string | null;
  constructor(stopReason: string | null, message = 'The assistant response could not be structured.') {
    super(message);
    this.name = 'AnthropicParseError';
    this.stopReason = stopReason;
  }
}

/** A single orchestrator diagnostics record: raw token usage + latency, never the key. */
export interface AnthropicCallDiagnostics {
  call: string; // generateQuestions | assessAnswers | draftSection | composeLearningCandidates
  projectId?: string;
  section?: string; // component:section, when applicable
  ok: boolean;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  error?: string; // error class name only — never raw key/model error text
}

export type AnthropicDiagnosticsSink = (record: AnthropicCallDiagnostics) => void;

let diagnosticsSink: AnthropicDiagnosticsSink = () => {
  /* default: no-op (server can install a real sink) */
};

/** Override the diagnostics sink (tests capture per-call token/latency this way). */
export function setAnthropicDiagnosticsSink(next: AnthropicDiagnosticsSink): () => void {
  const prev = diagnosticsSink;
  diagnosticsSink = next;
  return () => {
    diagnosticsSink = prev;
  };
}

/**
 * The minimal SDK surface the client needs — `messages.parse` (+ `messages.stream`
 * for the draftSection retry). Tests inject a stub implementing this so no real
 * LLM is contacted. The real `Anthropic` client satisfies this structurally.
 */
export interface MessagesLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parse(params: any, options?: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream?(params: any, options?: any): any;
}
export interface AnthropicLike {
  messages: MessagesLike;
}

/** The resolved `main`-tier config the client runs against. */
export interface MainTierConfig {
  apiKey: string;
  baseUrl: string | null;
  model: string;
}

export interface ParseContext {
  system: string;
  user: string;
  /** Tagging for the diagnostics record (never affects the request). */
  call: string;
  projectId?: string;
  section?: string;
}

export interface ParseOptions {
  /** When true, a `max_tokens` stop triggers ONE streaming retry at 32K (draftSection only, F3). */
  retryOnMaxTokens?: boolean;
  /** Override effort (default omitted → SDK `high`). `assessAnswers` may use `medium`. */
  effort?: 'low' | 'medium' | 'high';
}

export class AnthropicClient {
  private readonly sdk: AnthropicLike;
  private readonly model: string;

  constructor(sdk: AnthropicLike, model: string) {
    this.sdk = sdk;
    this.model = model;
  }

  /**
   * Resolve the `main` agent tier → provider → key/base_url/model from the DB
   * (via the SecretStore), falling back to `ANTHROPIC_API_KEY`. Throws
   * `AnthropicConfigError` when no key can be resolved (F30/F27 entry guard).
   */
  static async resolveMainTier(deps?: {
    db?: Db;
    secrets?: SecretStore;
  }): Promise<MainTierConfig> {
    const db = deps?.db ?? getDb();

    const [tier] = await db
      .select({ providerId: agentTier.providerId, model: agentTier.model })
      .from(agentTier)
      .where(eq(agentTier.tier, 'main'))
      .limit(1);

    let apiKey: string | null = null;
    let baseUrl: string | null = null;
    let model = tier?.model?.trim() || DEFAULT_MAIN_MODEL;

    if (tier?.providerId) {
      const [prov] = await db
        .select({ type: provider.type, baseUrl: provider.baseUrl, apiKeyRef: provider.apiKeyRef })
        .from(provider)
        .where(eq(provider.id, tier.providerId))
        .limit(1);
      if (prov) {
        if (prov.type !== 'claude') {
          throw new AnthropicConfigError(
            'The main tier must be an Anthropic-compatible provider (type=claude). Configure it in Team Settings.',
          );
        }
        baseUrl = prov.baseUrl?.trim() || null;
        if (prov.apiKeyRef) {
          const secrets = deps?.secrets ?? (await PostgresSecretStore.create({ db }));
          apiKey = await secrets.get(prov.apiKeyRef);
        }
      }
    }

    // Fallback to the env key (dev / unconfigured-secret-ref path).
    if (!apiKey) {
      const envKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (envKey) apiKey = envKey;
    }

    if (!apiKey) {
      throw new AnthropicConfigError(
        'No API key configured for the main tier. Configure the main tier in Team Settings.',
      );
    }

    return { apiKey, baseUrl, model };
  }

  /** Construct against the real SDK, resolving the `main`-tier key/model from config. */
  static async fromMainTier(deps?: { db?: Db; secrets?: SecretStore }): Promise<AnthropicClient> {
    const cfg = await AnthropicClient.resolveMainTier(deps);
    const sdk = new Anthropic({
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
      maxRetries: ANTHROPIC_MAX_RETRIES,
    });
    return new AnthropicClient(sdk, cfg.model);
  }

  /**
   * Run one structured-output call. Returns the validated `parsed_output`, or
   * throws `AnthropicParseError` when the model returns no parseable output.
   *
   * On a `max_tokens` stop with `retryOnMaxTokens` (draftSection only), retries
   * ONCE on a streaming call at `DRAFT_RETRY_MAX_TOKENS` (F3/F18).
   */
  async parse<T>(schema: z.ZodType<T>, ctx: ParseContext, opts: ParseOptions = {}): Promise<T> {
    const start = Date.now();
    try {
      const res = await this.sdk.messages.parse(
        {
          model: this.model,
          max_tokens: BASE_MAX_TOKENS,
          thinking: { type: 'adaptive' },
          ...(opts.effort ? { output_config: { effort: opts.effort, format: zodOutputFormat(schema) } } : { output_config: { format: zodOutputFormat(schema) } }),
          system: ctx.system,
          messages: [{ role: 'user', content: ctx.user }],
        },
        { signal: AbortSignal.timeout(ANTHROPIC_CALL_TIMEOUT_MS) },
      );

      if (res.parsed_output == null) {
        // A max_tokens stop on draftSection → one streaming retry at 32K (F3/F18).
        if (opts.retryOnMaxTokens && res.stop_reason === 'max_tokens') {
          this.emit(ctx, start, false, res, 'max_tokens');
          return await this.streamRetry(schema, ctx);
        }
        this.emit(ctx, start, false, res, res.stop_reason ?? 'no_parsed_output');
        throw new AnthropicParseError(res.stop_reason ?? null);
      }

      this.emit(ctx, start, true, res);
      return res.parsed_output as T;
    } catch (err) {
      if (err instanceof AnthropicParseError) throw err;
      this.emit(ctx, start, false, null, errName(err));
      throw err;
    }
  }

  /** The draftSection streaming retry — a streaming `parse` at 32K (F3/F18). */
  private async streamRetry<T>(schema: z.ZodType<T>, ctx: ParseContext): Promise<T> {
    const start = Date.now();
    if (!this.sdk.messages.stream) {
      // Should not happen against the real SDK; surface as a parse failure.
      this.emit(ctx, start, false, null, 'no_stream_support');
      throw new AnthropicParseError(null);
    }
    try {
      const stream = this.sdk.messages.stream(
        {
          model: this.model,
          max_tokens: DRAFT_RETRY_MAX_TOKENS,
          thinking: { type: 'adaptive' },
          output_config: { format: zodOutputFormat(schema) },
          system: ctx.system,
          messages: [{ role: 'user', content: ctx.user }],
        },
        { signal: AbortSignal.timeout(ANTHROPIC_CALL_TIMEOUT_MS) },
      );
      const final = await stream.finalMessage();
      if (final.parsed_output == null) {
        this.emit(ctx, start, false, final, final.stop_reason ?? 'no_parsed_output');
        throw new AnthropicParseError(final.stop_reason ?? null);
      }
      this.emit(ctx, start, true, final);
      return final.parsed_output as T;
    } catch (err) {
      if (err instanceof AnthropicParseError) throw err;
      this.emit(ctx, start, false, null, errName(err));
      throw err;
    }
  }

  /** Emit one diagnostics record (token usage + latency); never the key/model error text. */
  private emit(ctx: ParseContext, start: number, ok: boolean, res: unknown, error?: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = (res as any)?.usage ?? {};
    diagnosticsSink({
      call: ctx.call,
      ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
      ...(ctx.section ? { section: ctx.section } : {}),
      ok,
      latencyMs: Date.now() - start,
      inputTokens: numOrNull(usage.input_tokens),
      outputTokens: numOrNull(usage.output_tokens),
      cacheCreationInputTokens: numOrNull(usage.cache_creation_input_tokens),
      cacheReadInputTokens: numOrNull(usage.cache_read_input_tokens),
      ...(error ? { error } : {}),
    });
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}
