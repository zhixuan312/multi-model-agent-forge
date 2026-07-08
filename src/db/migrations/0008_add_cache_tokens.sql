-- The SDK's input_tokens excludes cache; total tokens = input + output + cache
-- (cached-read + cache-creation). Capture the cache total so usage isn't
-- undercounted. Backfilled from result jsonb by scripts/backfill-usage-columns.ts.
ALTER TABLE forge.ops_mma_batch ADD COLUMN IF NOT EXISTS cache_tokens integer;
