import { eq, and, inArray } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { learningCandidate } from '@/db/schema/artifacts';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

async function handleJournalRecord(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const request = ctx.request as { learningIds?: string[] };
  const learningIds = request.learningIds ?? [];
  if (learningIds.length === 0) return;

  const output = ((envelope as Record<string, unknown>)?.output ?? {}) as Record<string, unknown>;
  const recordedNodeId = typeof output.contextBlockId === 'string' ? output.contextBlockId : null;

  await db
    .update(learningCandidate)
    .set({ status: 'recorded', ...(recordedNodeId && { recordedNodeId }) })
    .where(inArray(learningCandidate.id, learningIds));
}

registerHandler('journal-record', handleJournalRecord);
