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
}
