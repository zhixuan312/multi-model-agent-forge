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
import { DraftSectionSchema, AssessAnswersSchema } from '@/spec/schemas';

const USAGE = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

function sdkReturning(out: unknown, stop = 'end_turn'): AnthropicLike {
  return {
    messages: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const out = await c.parse(AssessAnswersSchema, ctx);
    expect(out.aiSatisfied).toBe(true);
  });

  it('throws AnthropicParseError carrying stop_reason when parsed_output is null', async () => {
    const sdk: AnthropicLike = {
      messages: { async parse() { return { parsed_output: null, stop_reason: 'refusal', usage: USAGE }; } },
    };
    const c = new AnthropicClient(sdk, 'm');
    await expect(c.parse(AssessAnswersSchema, ctx)).rejects.toMatchObject({
      name: 'AnthropicParseError',
      stopReason: 'refusal',
    });
  });

  it('uses BASE_MAX_TOKENS (16000) on the base call', async () => {
    let seen = 0;
    const sdk: AnthropicLike = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: { async parse(p: any) { seen = p.max_tokens; return { parsed_output: { draftMd: 'x' }, stop_reason: 'end_turn', usage: USAGE }; } },
    };
    await new AnthropicClient(sdk, 'm').parse(DraftSectionSchema, { ...ctx, call: 'draftSection' });
    expect(seen).toBe(BASE_MAX_TOKENS);
  });

  it('draftSection max_tokens stop retries ONCE on a STREAMING call at exactly 32000', async () => {
    const maxTokensSeen: number[] = [];
    const usedStream: boolean[] = [];
    const sdk: AnthropicLike = {
      messages: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async parse(p: any) {
          maxTokensSeen.push(p.max_tokens);
          usedStream.push(false);
          return { parsed_output: null, stop_reason: 'max_tokens', usage: USAGE };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stream(p: any) {
          maxTokensSeen.push(p.max_tokens);
          usedStream.push(true);
          return { async finalMessage() { return { parsed_output: { draftMd: 'streamed' }, stop_reason: 'end_turn', usage: USAGE }; } };
        },
      },
    };
    const c = new AnthropicClient(sdk, 'm');
    const out = await c.parse(DraftSectionSchema, { ...ctx, call: 'draftSection' }, { retryOnMaxTokens: true });
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
    await expect(new AnthropicClient(sdk, 'm').parse(AssessAnswersSchema, ctx)).rejects.toBeInstanceOf(AnthropicParseError);
    expect(calls).toBe(1);
  });

  it('logs raw token usage + latency to the diagnostics channel on success AND error (F22/F4)', async () => {
    const records: AnthropicCallDiagnostics[] = [];
    const restore = setAnthropicDiagnosticsSink((r) => records.push(r));
    try {
      await new AnthropicClient(sdkReturning({ aiSatisfied: true, missingInfo: [], followUpQuestions: [] }), 'm').parse(
        AssessAnswersSchema,
        ctx,
      );
      const errSdk: AnthropicLike = {
        messages: { async parse() { return { parsed_output: null, stop_reason: 'refusal', usage: USAGE }; } },
      };
      await new AnthropicClient(errSdk, 'm').parse(AssessAnswersSchema, ctx).catch(() => {});
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
  it('throws AnthropicConfigError when no key is configured', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    // db returns a main tier with no provider → no key, no env fallback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ providerId: null, model: null }] }) }) }),
    };
    try {
      await expect(AnthropicClient.resolveMainTier({ db })).rejects.toBeInstanceOf(AnthropicConfigError);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('rejects a non-claude provider for the main tier (F30)', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    let stage = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              stage += 1;
              if (stage === 1) return [{ providerId: 'p1', model: 'claude-opus-4-8' }];
              return [{ type: 'codex', baseUrl: null, apiKeyRef: 'ref' }];
            },
          }),
        }),
      }),
    };
    const secrets = { get: async () => 'sk-test', put: async () => 'x', delete: async () => {} };
    try {
      await expect(AnthropicClient.resolveMainTier({ db, secrets })).rejects.toBeInstanceOf(AnthropicConfigError);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('resolves the key from the provider via the SecretStore + falls back to env', async () => {
    let stage = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              stage += 1;
              if (stage === 1) return [{ providerId: 'p1', model: 'custom-model' }];
              return [{ type: 'claude', baseUrl: 'https://x', apiKeyRef: 'ref' }];
            },
          }),
        }),
      }),
    };
    const secrets = { get: async (id: string) => (id === 'ref' ? 'sk-resolved' : null), put: async () => 'x', delete: async () => {} };
    const cfg = await AnthropicClient.resolveMainTier({ db, secrets });
    expect(cfg.apiKey).toBe('sk-resolved');
    expect(cfg.baseUrl).toBe('https://x');
    expect(cfg.model).toBe('custom-model');
  });
});

describe('client config', () => {
  it('exposes the raised retry budget (maxRetries: 4, F12)', () => {
    expect(ANTHROPIC_MAX_RETRIES).toBe(4);
  });
});
