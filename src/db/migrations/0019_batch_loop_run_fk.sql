-- Link every ops_mma_batch to the loop_run that spawned it (one-to-many).
-- A loop run creates 3-5 batches (main, recall, delegate, record, etc.);
-- the old loop_run.mma_batch_id pointed to just the delegate.
ALTER TABLE "forge"."ops_mma_batch" ADD COLUMN "loop_run_id" uuid REFERENCES "forge"."loop_run"("id");
ALTER TABLE "forge"."ops_mma_batch" ADD COLUMN "implementer_tier" text;

CREATE INDEX "mma_batch_loop_run_idx" ON "forge"."ops_mma_batch" ("loop_run_id") WHERE "loop_run_id" IS NOT NULL;
