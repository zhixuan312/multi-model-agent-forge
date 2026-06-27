import type { Db } from '@/db/client';

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
  let raw = typeof summaryRaw === 'string'
    ? summaryRaw
    : summaryRaw && typeof summaryRaw === 'object'
      ? JSON.stringify(summaryRaw)
      : '';
  if (!raw) throw new Error('No parseable response in MMA envelope');

  // Strip markdown code fences
  raw = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '');

  // Find the end of the JSON structure (first balanced close of { or [)
  const startChar = raw.trim()[0];
  if (startChar === '{' || startChar === '[') {
    const close = startChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    const trimmed = raw.trim();
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === startChar) depth++;
      if (c === close) depth--;
      if (depth === 0) return trimmed.slice(0, i + 1);
    }
  }

  // Fallback: strip trailing fence and whitespace
  raw = raw.replace(/\n?```\s*$/, '').trim();
  return raw;
}

let initialized = false;

export function ensureHandlersRegistered(): void {
  if (initialized) return;
  initialized = true;
  // Lazy import to avoid circular initialization issues
  import('./handlers/spec-audit').catch(() => {});
  import('./handlers/plan-audit').catch(() => {});
  import('./handlers/spec-auto-draft').catch(() => {});
  import('./handlers/spec-refine').catch(() => {});
  import('./handlers/plan-author').catch(() => {});
  import('./handlers/explore-propose').catch(() => {});
  import('./handlers/explore-synthesize').catch(() => {});
  import('./handlers/spec-learnings').catch(() => {});
  import('./handlers/spec-audit-apply').catch(() => {});
  import('./handlers/plan-audit-apply').catch(() => {});
  import('./handlers/plan-refine').catch(() => {});
}
