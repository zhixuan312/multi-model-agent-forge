// @vitest-environment node
import {
  AnthropicClient,
  AnthropicConfigError,
  AnthropicParseError,
  DRAFT_RETRY_MAX_TOKENS,
  BASE_MAX_TOKENS,
  ANTHROPIC_MAX_RETRIES,
  setAnthropicDiagnosticsSink,
  type AnthropicLike,
  type AnthropicCallDiagnostics,
} from '@/anthropic/client';
import { z } from 'zod';
import { FullSpecDraftSchema } from '@/spec/schemas';

const TestSchema = z.object({ aiSatisfied: z.boolean(), missingInfo: z.array(z.string()), followUpQuestions: z.array(z.string()) });
const DraftSchema = z.object({ draftMd: z.string() });

const USAGE = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

function sdkReturning(out: unknown, stop = 'end_turn'): AnthropicLike {
  return {
    messages: {
       
      async parse() {
        return { parsed_output: out, stop_reason: stop, usage: USAGE };
      },
    },
  };
}

describe('AnthropicClient.parse', () => {
  const ctx = { system: 's', user: 'u', call: 'assessAnswers' };

  it('returns parsed_output on success', async () => {
    const c = new AnthropicClient(sdkReturning({ aiSatisfied: true, missingInfo: [], followUpQuestions: [] }), 'm');
    const out = await c.parse(TestSchema, ctx);
    expect(out.aiSatisfied).toBe(true);
  });

  it('throws AnthropicParseError carrying stop_reason when parsed_output is null', async () => {
    const sdk: AnthropicLike = {
      messages: { async parse() { return { parsed_output: null, stop_reason: 'refusal', usage: USAGE }; } },
    };
    const c = new AnthropicClient(sdk, 'm');
    await expect(c.parse(TestSchema, ctx)).rejects.toMatchObject({
      name: 'AnthropicParseError',
      stopReason: 'refusal',
    });
  });

  it('uses BASE_MAX_TOKENS (16000) on the base call', async () => {
    let seen = 0;
    const sdk: AnthropicLike = {
       
      messages: { async parse(p: any) { seen = p.max_tokens; return { parsed_output: { draftMd: 'x' }, stop_reason: 'end_turn', usage: USAGE }; } },
    };
    await new AnthropicClient(sdk, 'm').parse(DraftSchema, { ...ctx, call: 'draftSection' });
    expect(seen).toBe(BASE_MAX_TOKENS);
  });

  it('draftSection max_tokens stop retries ONCE on a STREAMING call at exactly 32000', async () => {
    const maxTokensSeen: number[] = [];
    const usedStream: boolean[] = [];
    const sdk: AnthropicLike = {
      messages: {
         
        async parse(p: any) {
          maxTokensSeen.push(p.max_tokens);
          usedStream.push(false);
          return { parsed_output: null, stop_reason: 'max_tokens', usage: USAGE };
        },
         
        stream(p: any) {
          maxTokensSeen.push(p.max_tokens);
          usedStream.push(true);
          return { async finalMessage() { return { parsed_output: { draftMd: 'streamed' }, stop_reason: 'end_turn', usage: USAGE }; } };
        },
      },
    };
    const c = new AnthropicClient(sdk, 'm');
    const out = await c.parse(DraftSchema, { ...ctx, call: 'draftSection' }, { retryOnMaxTokens: true });
    expect(out.draftMd).toBe('streamed');
    expect(maxTokensSeen).toEqual([BASE_MAX_TOKENS, DRAFT_RETRY_MAX_TOKENS]);
    expect(DRAFT_RETRY_MAX_TOKENS).toBe(32000);
    expect(usedStream).toEqual([false, true]); // retry uses the streaming path (F3/F18)
  });

  it('does NOT retry on max_tokens for non-draft calls (treated as a parse failure)', async () => {
    let calls = 0;
    const sdk: AnthropicLike = {
      messages: { async parse() { calls += 1; return { parsed_output: null, stop_reason: 'max_tokens', usage: USAGE }; } },
    };
    await expect(new AnthropicClient(sdk, 'm').parse(TestSchema, ctx)).rejects.toBeInstanceOf(AnthropicParseError);
    expect(calls).toBe(1);
  });

  it('logs raw token usage + latency to the diagnostics channel on success AND error (F22/F4)', async () => {
    const records: AnthropicCallDiagnostics[] = [];
    const restore = setAnthropicDiagnosticsSink((r) => records.push(r));
    try {
      await new AnthropicClient(sdkReturning({ aiSatisfied: true, missingInfo: [], followUpQuestions: [] }), 'm').parse(
        TestSchema,
        ctx,
      );
      const errSdk: AnthropicLike = {
        messages: { async parse() { return { parsed_output: null, stop_reason: 'refusal', usage: USAGE }; } },
      };
      await new AnthropicClient(errSdk, 'm').parse(TestSchema, ctx).catch(() => {});
    } finally {
      restore();
    }
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ ok: true, inputTokens: 10, outputTokens: 5 });
    expect(typeof records[0].latencyMs).toBe('number');
    expect(records[1].ok).toBe(false);
  });
});

describe('AnthropicClient.resolveMainTier', () => {
  // A config.json tier reader: main carries `model` (or none); auth is OAuth/env.
  const tiersWith = (mainModel: string | null) => () => ({
    main: mainModel ? { dialect: 'claude', model: mainModel, baseUrl: null, authMode: 'oauth' as const } : null,
    complex: null,
    standard: null,
  });

  it('throws AnthropicConfigError when no auth is configured', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // oauth:() => null simulates a server with no Claude Code login + no env key.
      await expect(
        AnthropicClient.resolveMainTier({ tiers: tiersWith(null), oauth: () => null }),
      ).rejects.toBeInstanceOf(AnthropicConfigError);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('takes the main model from config.json; OAuth is the auth', async () => {
    const cfg = await AnthropicClient.resolveMainTier({
      tiers: tiersWith('custom-model'),
      oauth: () => ({ accessToken: 'oat-1' }),
    });
    expect(cfg.model).toBe('custom-model');
    expect(cfg.auth).toEqual({ mode: 'oauth', oauthToken: 'oat-1' });
  });

  it('defaults the model when config.json has no main tier', async () => {
    const cfg = await AnthropicClient.resolveMainTier({
      tiers: tiersWith(null),
      oauth: () => ({ accessToken: 'oat-2' }),
    });
    expect(cfg.model).toBe('claude-opus-4-8');
    expect(cfg.auth.mode).toBe('oauth');
  });

  it('falls back to the ANTHROPIC_API_KEY env when there is no OAuth', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-env';
    try {
      const cfg = await AnthropicClient.resolveMainTier({ tiers: tiersWith('m'), oauth: () => null });
      expect(cfg.auth).toEqual({ mode: 'apiKey', apiKey: 'sk-env', baseUrl: null });
      expect(cfg.model).toBe('m');
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe('AnthropicClient — server Claude Code OAuth', () => {
  const ctx = { system: 'real-system', user: 'u', call: 'assessAnswers' };

  it('OAuth mode injects the Claude Code identity as the FIRST system block', async () => {
     
    let seen: any;
    const sdk: AnthropicLike = {
       
      messages: { async parse(p: any) { seen = p.system; return { parsed_output: { aiSatisfied: true, missingInfo: [], followUpQuestions: [] }, stop_reason: 'end_turn', usage: USAGE }; } },
    };
    await new AnthropicClient(sdk, 'm', true).parse(TestSchema, ctx);
    expect(Array.isArray(seen)).toBe(true);
    expect(seen[0]).toEqual({ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." });
    expect(seen[1]).toEqual({ type: 'text', text: 'real-system' });
  });

  it('API-key mode keeps a plain-string system (no identity block)', async () => {
     
    let seen: any;
    const sdk: AnthropicLike = {
       
      messages: { async parse(p: any) { seen = p.system; return { parsed_output: { aiSatisfied: true, missingInfo: [], followUpQuestions: [] }, stop_reason: 'end_turn', usage: USAGE }; } },
    };
    await new AnthropicClient(sdk, 'm', false).parse(TestSchema, ctx);
    expect(seen).toBe('real-system');
  });
});

describe('client config', () => {
  it('exposes the raised retry budget (maxRetries: 4, F12)', () => {
    expect(ANTHROPIC_MAX_RETRIES).toBe(4);
  });
});
