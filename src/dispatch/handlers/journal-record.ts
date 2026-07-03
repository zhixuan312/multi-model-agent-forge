import type { Db } from '@/db/client';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';
import { updateDetails } from '@/details/write';

async function handleJournalRecord(db: Db, ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  await updateDetails(db, ctx.projectId, (d) => {
    for (const l of d.stages.journal.phases.journal.learnings) {
      if (l.status === 'kept') l.status = 'recorded';
    }
    return d;
  });
}

registerHandler('journal-record', handleJournalRecord);
