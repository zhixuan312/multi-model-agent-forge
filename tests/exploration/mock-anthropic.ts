// @vitest-environment node
// A minimal mock of the `Pick<AnthropicClient, 'parse'>` surface the exploration
// modules consume. Returns scripted parsed_output keyed by the `ctx.call` tag,
// so no real LLM is contacted. Mirrors the mockProvider/failProvider discipline.
import type { z } from 'zod';

export interface ParseCall {
  call: string;
  system: string;
  user: string;
}

export interface MockParseOpts {
  /** Scripted return value for the NEXT parse of each `ctx.call` tag (a queue). */
  byCall: Record<string, unknown[]>;
  /** Throw on the next parse of this `ctx.call` tag. */
  throwOn?: Set<string>;
  /** Records every parse call (tag + prompts). */
  calls?: ParseCall[];
}

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, durationMs: 0 };

export function mockAnthropic(opts: MockParseOpts): {
  parse: <T>(schema: z.ZodType<T>, ctx: { call: string; system: string; user: string }) => Promise<T>;
  parseWithUsage: <T>(schema: z.ZodType<T>, ctx: { call: string; system: string; user: string }) => Promise<{ data: T; usage: typeof ZERO_USAGE }>;
} {
  const queues: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(opts.byCall)) queues[k] = [...v];

  async function doParse<T>(_schema: z.ZodType<T>, ctx: { call: string; system: string; user: string }): Promise<T> {
    opts.calls?.push({ call: ctx.call, system: ctx.system, user: ctx.user });
    if (opts.throwOn?.has(ctx.call)) {
      opts.throwOn.delete(ctx.call);
      throw new Error(`mockAnthropic: scripted failure for '${ctx.call}'`);
    }
    const next = (queues[ctx.call] ?? []).shift();
    if (next === undefined) {
      throw new Error(`mockAnthropic: no scripted response for '${ctx.call}'`);
    }
    return next as T;
  }

  return {
    parse: doParse,
    async parseWithUsage<T>(schema: z.ZodType<T>, ctx: { call: string; system: string; user: string }) {
      return { data: await doParse(schema, ctx), usage: ZERO_USAGE };
    },
  };
}
