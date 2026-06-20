import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { readMmaTiers, type MmaTiers } from '@/mma/mma-config-reader';
import {
  getClaudeOAuth,
  CLAUDE_CODE_OAUTH_BETA,
  CLAUDE_CODE_IDENTITY,
  type ClaudeOAuthCredentials,
} from '@/anthropic/claude-oauth';

/**
 * `AnthropicClient` (Spec 4 / lib/anthropic/client.ts) — the ONLY Anthropic
 * surface in the product. It wraps `@anthropic-ai/sdk` and exposes typed
 * structured-output calls via `messages.parse` + `zodOutputFormat` (Zod 4),
 * `claude-opus-4-8`, and adaptive thinking.
 *
 * The model comes from the `main` tier in the engine's `config.json` (the source
 * of truth set via the Models tab); auth is the server's Claude Code subscription
 * OAuth, with an `ANTHROPIC_API_KEY` env fallback. The key/token is NEVER logged.
 * A clear typed error is thrown when no auth is configured.
 *
 * The class is pure/DI-testable: an SDK-like `messages` impl can be injected so
 * tests never call a real LLM.
 */

/** The model used when the `main` tier carries no explicit model (technical.md §7.2). */
export const DEFAULT_MAIN_MODEL = 'claude-opus-4-8';

/** Hard per-call ceiling (F18/F23). 120s — well above worst-case, below the SDK's ~10-min guard. */
export const ANTHROPIC_CALL_TIMEOUT_MS = 300_000;

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

/**
 * How the `main` tier authenticates against Anthropic:
 *  - `apiKey`: a real x-api-key (explicit provider key in Team Settings, or env).
 *  - `oauth`: the **server's Claude Code subscription** bearer token (Keychain) —
 *    used when no per-team key is configured, so all tiers share the one
 *    "server Claude Code auth". OAuth mode requires the beta header + the
 *    Claude-Code identity system block (see `fromMainTier` / `buildSystem`).
 */
export type MainTierAuth =
  | { mode: 'apiKey'; apiKey: string; baseUrl: string | null }
  | { mode: 'oauth'; oauthToken: string };

/** The resolved `main`-tier config the client runs against. */
export interface MainTierConfig {
  auth: MainTierAuth;
  model: string;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  durationMs: number;
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
  private readonly oauthMode: boolean;

  constructor(sdk: AnthropicLike, model: string, oauthMode = false) {
    this.sdk = sdk;
    this.model = model;
    this.oauthMode = oauthMode;
  }

  /**
   * Build the `system` parameter. In OAuth (subscription) mode the Claude Code
   * identity MUST be the first system block or the token is rejected; the real
   * Forge prompt follows as a second block. In API-key mode it's a plain string.
   */
  private buildSystem(system: string): string | Array<{ type: 'text'; text: string }> {
    return this.oauthMode
      ? [
          { type: 'text', text: CLAUDE_CODE_IDENTITY },
          { type: 'text', text: system },
        ]
      : system;
  }

  /**
   * Resolve the `main`-tier model + auth. The MODEL comes from the engine's
   * `config.json` (`agents.main.model`, set via the Models tab), defaulting to
   * `DEFAULT_MAIN_MODEL` when unconfigured. AUTH is the server's Claude Code
   * subscription OAuth, with an `ANTHROPIC_API_KEY` env fallback. Throws
   * `AnthropicConfigError` when no auth can be resolved (F30/F27 entry guard).
   */
  static async resolveMainTier(deps?: {
    oauth?: () => ClaudeOAuthCredentials | null;
    /** Injectable tier reader (tests); defaults to the engine's config.json. */
    tiers?: () => MmaTiers;
  }): Promise<MainTierConfig> {
    const readOAuth = deps?.oauth ?? getClaudeOAuth;
    const readTiers = deps?.tiers ?? readMmaTiers;

    const model = readTiers().main?.model?.trim() || DEFAULT_MAIN_MODEL;

    // 1. The server's Claude Code subscription OAuth — the shared main-tier auth.
    const oauth = readOAuth();
    if (oauth?.accessToken) {
      return { auth: { mode: 'oauth', oauthToken: oauth.accessToken }, model };
    }

    // 2. Env API key fallback (dev / CI).
    const envKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (envKey) {
      return { auth: { mode: 'apiKey', apiKey: envKey, baseUrl: null }, model };
    }

    throw new AnthropicConfigError(
      'No Anthropic auth for the main tier. Sign in to Claude Code on the server (Claude Max subscription), or set ANTHROPIC_API_KEY.',
    );
  }

  /** Construct against the real SDK, resolving the `main`-tier auth/model from config. */
  static async fromMainTier(deps?: {
    oauth?: () => ClaudeOAuthCredentials | null;
    tiers?: () => MmaTiers;
  }): Promise<AnthropicClient> {
    const cfg = await AnthropicClient.resolveMainTier(deps);
    if (cfg.auth.mode === 'oauth') {
      // Subscription bearer token: Authorization: Bearer + the oauth beta header.
      // The Claude-Code identity system block is injected per-call (buildSystem).
      const sdk = new Anthropic({
        authToken: cfg.auth.oauthToken,
        defaultHeaders: { 'anthropic-beta': CLAUDE_CODE_OAUTH_BETA },
        maxRetries: ANTHROPIC_MAX_RETRIES,
      });
      return new AnthropicClient(sdk, cfg.model, true);
    }
    const sdk = new Anthropic({
      apiKey: cfg.auth.apiKey,
      ...(cfg.auth.baseUrl ? { baseURL: cfg.auth.baseUrl } : {}),
      maxRetries: ANTHROPIC_MAX_RETRIES,
    });
    return new AnthropicClient(sdk, cfg.model, false);
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
          system: this.buildSystem(ctx.system),
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

  /** Like `parse` but also returns token usage for the caller to record. */
  async parseWithUsage<T>(schema: z.ZodType<T>, ctx: ParseContext, opts: ParseOptions = {}): Promise<{ data: T; usage: CallUsage }> {
    const start = Date.now();
    try {
      const res = await this.sdk.messages.parse(
        {
          model: this.model,
          max_tokens: BASE_MAX_TOKENS,
          thinking: { type: 'adaptive' },
          ...(opts.effort ? { output_config: { effort: opts.effort, format: zodOutputFormat(schema) } } : { output_config: { format: zodOutputFormat(schema) } }),
          system: this.buildSystem(ctx.system),
          messages: [{ role: 'user', content: ctx.user }],
        },
        { signal: AbortSignal.timeout(ANTHROPIC_CALL_TIMEOUT_MS) },
      );
      if (res.parsed_output == null) {
        this.emit(ctx, start, false, res, res.stop_reason ?? 'no_parsed_output');
        throw new AnthropicParseError(res.stop_reason ?? null);
      }
      this.emit(ctx, start, true, res);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = (res as any).usage ?? {};
      return {
        data: res.parsed_output as T,
        usage: {
          inputTokens: numOrNull(u.input_tokens) ?? 0,
          outputTokens: numOrNull(u.output_tokens) ?? 0,
          cacheReadInputTokens: numOrNull(u.cache_read_input_tokens) ?? 0,
          cacheCreationInputTokens: numOrNull(u.cache_creation_input_tokens) ?? 0,
          durationMs: Date.now() - start,
        },
      };
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
          system: this.buildSystem(ctx.system),
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
