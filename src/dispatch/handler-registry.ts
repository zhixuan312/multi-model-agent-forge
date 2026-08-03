import type { Db } from '@/db/client';
import { extractJsonText } from '@/lib/llm-json';

export interface MmaBatchCtx {
  batchRowId: string;
  projectId: string;
  handler: string;
  request: unknown;
  actorId: string | null;
}

export type OnTerminalHandler = (
  db: Db,
  ctx: MmaBatchCtx,
  envelope: unknown,
) => Promise<void>;

const registry = new Map<string, OnTerminalHandler>();

export function registerHandler(key: string, handler: OnTerminalHandler): void {
  registry.set(key, handler);
}

export function getHandler(key: string): OnTerminalHandler | undefined {
  return registry.get(key);
}

/**
 * Extract JSON text from an MMA envelope's output.summary (v5.4+).
 * Handles: markdown code fences, trailing commentary after JSON, nested objects/arrays.
 */
export function extractJsonFromEnvelope(envelope: unknown): string {
  const env = envelope as Record<string, unknown>;
  const output = env?.output as { summary?: unknown } | undefined;
  const summaryRaw = output?.summary;
  const raw = typeof summaryRaw === 'string'
    ? summaryRaw
    : summaryRaw && typeof summaryRaw === 'object'
      ? JSON.stringify(summaryRaw)
      : '';
  if (!raw) throw new Error('No parseable response in MMA envelope');

  // No JSON container in the reply: hand back the text so the caller's JSON.parse throws
  // with the actual content, rather than silently returning something empty-looking.
  return extractJsonText(raw) ?? raw.trim();
}

let registration: Promise<void> | null = null;

/**
 * Register every terminal handler and RESOLVE only once they are all in the
 * registry. Memoized: the imports run once, and every caller awaits the SAME
 * promise. Callers MUST `await` this before `getHandler` — the handlers
 * self-register on module import, so reading the registry before the imports
 * resolve returns `undefined` and a batch-backed dispatch would record no gating
 * state (the audit-pass push, the task validation, …) and re-dispatch forever.
 * That silent race is exactly what a fire-and-forget import list produced; the
 * lazy dynamic imports still avoid the circular-init issue static imports hit.
 */
export function ensureHandlersRegistered(): Promise<void> {
  if (!registration) {
    registration = Promise.all([
      import('./handlers/spec-audit'),
      import('./handlers/plan-audit'),
      import('./handlers/spec-auto-draft'),
      import('./handlers/spec-refine'),
      import('./handlers/plan-author'),
      import('./handlers/explore-propose'),
      import('./handlers/explore-synthesize'),
      import('./handlers/spec-audit-apply'),
      import('./handlers/plan-audit-apply'),
      import('./handlers/plan-refine'),
      import('./handlers/execute-pipeline'),
      import('./handlers/code-review'),
      import('./handlers/review-apply'),
      import('./handlers/journal-harvest'),
      import('./handlers/journal-record'),
    ]).then(() => undefined);
  }
  return registration;
}
