import type { Db } from '@/db/client';
import { registerHandler, type MmaBatchCtx } from '@/dispatch/handler-registry';

async function handleCodeReview(_db: Db, _ctx: MmaBatchCtx, _envelope: unknown): Promise<void> {
  // Review results are stored in the batch row's `result` column by PollManager.
  // The ReviewStageClient reads them from there on refresh. No additional processing needed.
}

registerHandler('code-review', handleCodeReview);
