-- Extract cost/token/duration scalars from ops_mma_batch.result jsonb
-- into proper columns for efficient SQL aggregation in the Usage page.
ALTER TABLE "forge"."ops_mma_batch" ADD COLUMN "cost_usd" numeric;
ALTER TABLE "forge"."ops_mma_batch" ADD COLUMN "saved_vs_main_usd" numeric;
ALTER TABLE "forge"."ops_mma_batch" ADD COLUMN "input_tokens" integer;
ALTER TABLE "forge"."ops_mma_batch" ADD COLUMN "output_tokens" integer;
ALTER TABLE "forge"."ops_mma_batch" ADD COLUMN "duration_ms" integer;
ALTER TABLE "forge"."ops_mma_batch" ADD COLUMN "implementer_model" text;
ALTER TABLE "forge"."ops_mma_batch" ADD COLUMN "reviewer_model" text;

CREATE INDEX "mma_batch_cost_period_idx"
  ON "forge"."ops_mma_batch" ("created_at" DESC, "cost_usd")
  WHERE "status" IN ('done', 'failed');
