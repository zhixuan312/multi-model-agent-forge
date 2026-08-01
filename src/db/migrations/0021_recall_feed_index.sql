-- Index the Journal → Recall feed query.
--
-- `app/(app)/journal/page.tsx` loads a member's five most recent recall answers on every
-- Recall tab render:
--
--   WHERE route = 'journal_recall' AND dispatched_by = <me>  ORDER BY created_at DESC LIMIT 5
--
-- `EXPLAIN ANALYZE` on the live database showed a **Seq Scan** filtering all 586 rows to
-- return 0, plus a sort. That is 0.6 ms today and unnoticeable — but `ops_mma_batch` is the
-- fastest-growing table in the system (one row per MMA dispatch, forever), and this runs on
-- a page load, so it degrades exactly as usage grows.
--
-- Column order is the query's shape: both equality predicates first so the index seeks
-- rather than filters, then `created_at DESC` so the LIMIT 5 walks the index and the sort
-- disappears entirely.
--
-- Why this was not in 0020: that migration's survey used `grep --include=*.ts`, which
-- silently excluded `.tsx` — and this call site lives in a page component. The other seven
-- unindexed foreign keys it examined are still genuinely unqueried; only this one was
-- missed. Recorded here because the omission, not the index, is the lesson.
--
-- Additive and idempotent: CREATE INDEX IF NOT EXISTS only.

CREATE INDEX IF NOT EXISTS "mma_batch_dispatcher_route_created_idx"
  ON "forge"."ops_mma_batch" ("dispatched_by", "route", "created_at" DESC);
