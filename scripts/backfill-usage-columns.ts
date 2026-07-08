/**
 * Backfill usage columns on ops_mma_batch from existing result jsonb.
 * Run with: npx tsx scripts/backfill-usage-columns.ts
 * Idempotent — safe to re-run. Processes 100 rows per batch.
 */
import { isNull, and, isNotNull, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { extractUsageFields } from '@/usage/extract-usage-fields';

async function main() {
  const db = getDb();
  let total = 0;
  let skipped = 0;

  for (;;) {
    const rows = await db
      .select({ id: mmaBatch.id, result: mmaBatch.result })
      .from(mmaBatch)
      .where(and(isNotNull(mmaBatch.result), isNull(mmaBatch.costUsd)))
      .limit(100);

    if (rows.length === 0) break;

    for (const row of rows) {
      const usage = extractUsageFields(row.result);
      if (usage.costUsd === null && usage.inputTokens === null) {
        console.warn(`[backfill] skipping batch ${row.id}: malformed envelope`);
        // Set costUsd to '0' sentinel so we don't re-process
        await db
          .update(mmaBatch)
          .set({ costUsd: '0' })
          .where(eq(mmaBatch.id, row.id));
        skipped += 1;
        continue;
      }

      await db
        .update(mmaBatch)
        .set({
          ...(usage.costUsd !== null && { costUsd: usage.costUsd }),
          ...(usage.savedVsMainUsd !== null && { savedVsMainUsd: usage.savedVsMainUsd }),
          ...(usage.inputTokens !== null && { inputTokens: usage.inputTokens }),
          ...(usage.outputTokens !== null && { outputTokens: usage.outputTokens }),
          ...(usage.durationMs !== null && { durationMs: usage.durationMs }),
        })
        .where(eq(mmaBatch.id, row.id));
      total += 1;
    }

    console.log(`[backfill] processed batch of ${rows.length} rows (${total} updated, ${skipped} skipped)`);
  }

  console.log(`[backfill] done. ${total} rows updated, ${skipped} skipped.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] fatal error:', err);
  process.exit(1);
});
