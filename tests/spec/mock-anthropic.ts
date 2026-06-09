// @vitest-environment node
// A MOCK AnthropicClient SDK surface for Spec-4 tests. NEVER calls a real LLM.
// It identifies the call by the schema's shape (the `output_config.format` keys)
// and returns scripted `parsed_output` values, plus a `usage` block so the
// diagnostics sink has token counts to record.
import { AnthropicClient, type AnthropicLike } from '@/anthropic/client';
import type {
  GenerateQuestions,
  AssessAnswers,
  DraftSection,
  ComposeLearnings,
} from '@/spec/schemas';

export type CallKind =
  | 'generateQuestions'
  | 'assessAnswers'
  | 'draftSection'
  | 'composeLearningCandidates';

/** What the mock should return for the NEXT call of each kind (a queue per kind). */
export interface MockScript {
  generateQuestions?: GenerateQuestions[];
  assessAnswers?: AssessAnswers[];
  draftSection?: DraftSection[];
  composeLearningCandidates?: ComposeLearnings[];
}

const USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/** Identify the call kind from the request's output_config schema property names. */
function classify(params: { output_config?: { format?: unknown } }): CallKind {
  // zodOutputFormat produces a JSON schema; inspect its property keys.
  const fmt = params.output_config?.format as
    | { schema?: { properties?: Record<string, unknown> }; json_schema?: { schema?: { properties?: Record<string, unknown> } } }
    | undefined;
  const props =
    fmt?.schema?.properties ?? fmt?.json_schema?.schema?.properties ?? {};
  const keys = Object.keys(props);
  if (keys.includes('aiSatisfiedWithoutAnswers')) return 'generateQuestions';
  if (keys.includes('draftMd')) return 'draftSection';
  if (keys.includes('candidates')) return 'composeLearningCandidates';
  return 'assessAnswers';
}

/** Build a mock AnthropicClient from a script + optional throw/stop overrides. */
export function mockAnthropicClient(
  script: MockScript,
  opts?: {
    /** Force `parsed_output: null` with this stop_reason on the next call of a kind. */
    nullStopReason?: Partial<Record<CallKind, string>>;
    /** Throw this error on the next call of a kind (SDK-style typed error). */
    throwOn?: Partial<Record<CallKind, unknown>>;
    /** Record every classified call for assertions. */
    calls?: CallKind[];
    /** Provide draftSection streaming-retry results (for the max_tokens retry path). */
    streamDraft?: DraftSection[];
    /** Record the max_tokens each parse/stream request used. */
    maxTokensSeen?: number[];
  },
): AnthropicClient {
  const queues: Record<CallKind, unknown[]> = {
    generateQuestions: [...(script.generateQuestions ?? [])],
    assessAnswers: [...(script.assessAnswers ?? [])],
    draftSection: [...(script.draftSection ?? [])],
    composeLearningCandidates: [...(script.composeLearningCandidates ?? [])],
  };
  const streamQueue = [...(opts?.streamDraft ?? [])];

  const sdk: AnthropicLike = {
    messages: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async parse(params: any) {
        const kind = classify(params);
        opts?.calls?.push(kind);
        opts?.maxTokensSeen?.push(params.max_tokens);

        const thrown = opts?.throwOn?.[kind];
        if (thrown !== undefined) {
          delete opts!.throwOn![kind];
          throw thrown;
        }

        const stop = opts?.nullStopReason?.[kind];
        if (stop !== undefined) {
          delete opts!.nullStopReason![kind];
          return { parsed_output: null, stop_reason: stop, usage: USAGE };
        }

        const next = queues[kind].shift();
        if (next === undefined) {
          throw new Error(`mockAnthropic: no scripted response for '${kind}'`);
        }
        return { parsed_output: next, stop_reason: 'end_turn', usage: USAGE };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stream(params: any) {
        opts?.calls?.push('draftSection');
        opts?.maxTokensSeen?.push(params.max_tokens);
        const next = streamQueue.shift();
        return {
          async finalMessage() {
            if (next === undefined) {
              return { parsed_output: null, stop_reason: 'max_tokens', usage: USAGE };
            }
            return { parsed_output: next, stop_reason: 'end_turn', usage: USAGE };
          },
        };
      },
    },
  };

  return new AnthropicClient(sdk, 'claude-opus-4-8');
}
