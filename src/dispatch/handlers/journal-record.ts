import { asc, and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { projectJournal } from '@/db/schema/project-journal';
import { correlateRecordedRows } from '@/journal/journal-record-request';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

async function handleJournalRecord(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const env = envelope as {
    task?: { status?: string };
    error?: { message?: string } | null;
    output?: { summary?: { recorded?: Array<{ learning: string; nodeId: string }>; failed?: Array<{ learning: string; reason: string }> } };
  };
  // FR-11c: a whole-request/whole-chunk failure leaves every row in this chunk `kept`.
  if (env.error != null || env.task?.status === 'failed') return;

  // FR-11: correlate returned `recorded[]` to rows by matching `learning`→`body`
  // (chunks dispatch sequentially, so recorded rows are excluded from `kept` before
  // the next chunk's handler runs — see correlateRecordedRows). Unmatched kept rows
  // (incl. any `failed[]`) stay `kept` and are retried on the next record trigger.
  const kept = await db.select().from(projectJournal)
    .where(and(eq(projectJournal.projectId, ctx.projectId), eq(projectJournal.status, 'kept')))
    .orderBy(asc(projectJournal.seq));
  const matches = correlateRecordedRows(kept, env.output?.summary?.recorded ?? []);
  const now = new Date();
  for (const match of matches) {
    await db.update(projectJournal).set({
      status: 'recorded', recordedNodeId: match.nodeId, recordedAt: now, updatedAt: now,
    }).where(eq(projectJournal.id, match.id));
  }
}

registerHandler('journal-record', handleJournalRecord);
