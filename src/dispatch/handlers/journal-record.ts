import { asc, and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { projectJournal } from '@/db/schema/project-journal';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

async function handleJournalRecord(db: Db, ctx: MmaBatchCtx, envelope: unknown): Promise<void> {
  const env = envelope as {
    task?: { status?: string };
    error?: { message?: string } | null;
    output?: { summary?: { recorded?: Array<{ learning: string; nodeId: string }>; failed?: Array<{ learning: string; reason: string }> } };
  };
  // FR-11c: a whole-request/whole-chunk failure leaves every row in this chunk `kept`.
  if (env.error != null || env.task?.status === 'failed') return;

  // FR-11: correlate returned entries to rows by matching `learning` to row `body`
  // (NOT array position — a failed entry desynchronizes indices). `seq` order
  // disambiguates identical bodies (first unmatched wins).
  const kept = await db.select().from(projectJournal)
    .where(and(eq(projectJournal.projectId, ctx.projectId), eq(projectJournal.status, 'kept')))
    .orderBy(asc(projectJournal.seq));
  const recorded = env.output?.summary?.recorded ?? [];
  const used = new Set<string>();
  const now = new Date();
  for (const rec of recorded) {
    const row = kept.find((r) => r.body === rec.learning && !used.has(r.id));
    if (!row) continue;
    used.add(row.id);
    await db.update(projectJournal).set({
      status: 'recorded', recordedNodeId: rec.nodeId, recordedAt: now, updatedAt: now,
    }).where(eq(projectJournal.id, row.id));
  }
  // Unmatched kept rows (incl. any in `failed[]`) stay `kept` and are retried on the next record trigger (FR-11a).
}

registerHandler('journal-record', handleJournalRecord);
