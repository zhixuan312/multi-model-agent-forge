import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import type { CallUsage } from '@/anthropic/client';

/**
 * Record a main-agent (orchestrator) call as an `mma_batch` row so it flows
 * through the same usage pipeline as MMA worker calls.
 */
export async function recordOrchestratorUsage(
  projectId: string,
  call: string,
  usage: CallUsage,
  deps: { db?: Db } = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, durationMs } = usage;
  const costUsd =
    (inputTokens * 5 + cacheReadInputTokens * 0.5 + cacheCreationInputTokens * 6.25 + outputTokens * 25) / 1_000_000;

  await db.insert(mmaBatch).values({
    projectId,
    route: 'orchestrate',
    cwd: resolveWorkspaceRoot(),
    status: 'done',
    request: { call },
    result: {},
    inputTokens: inputTokens + cacheReadInputTokens + cacheCreationInputTokens,
    outputTokens,
    costUsd: costUsd.toFixed(6),
    durationMs,
    implementerTier: 'main',
    terminalAt: new Date(),
  });
}
