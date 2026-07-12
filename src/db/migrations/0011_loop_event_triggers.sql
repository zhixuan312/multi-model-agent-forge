ALTER TABLE "forge"."loop_def" ADD COLUMN "mode" text;
ALTER TABLE "forge"."loop_def" ADD COLUMN "event_token_hash" text;

UPDATE "forge"."loop_def" SET "mode" = 'recurring' WHERE "cron" IS NOT NULL;

UPDATE "forge"."loop_def" SET "mode" = 'manual' WHERE "cron" IS NULL;

ALTER TABLE "forge"."loop_def"
  ALTER COLUMN "mode" SET DEFAULT 'manual',
  ALTER COLUMN "mode" SET NOT NULL;

ALTER TABLE "forge"."loop_run"
  DROP CONSTRAINT IF EXISTS "loop_run_trigger_check";

ALTER TABLE "forge"."loop_run"
  ADD CONSTRAINT "loop_run_trigger_check"
  CHECK ("trigger" IN ('schedule', 'manual', 'event'));

ALTER TABLE "forge"."loop_run" ADD COLUMN "idempotency_key" text;
ALTER TABLE "forge"."loop_run" ADD COLUMN "reference" text;

CREATE TABLE IF NOT EXISTS "forge"."loop_event_delivery" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL REFERENCES "forge"."team"("id"),
  "loop_id" uuid NOT NULL REFERENCES "forge"."loop_def"("id") ON DELETE CASCADE,
  "idempotency_key" text NOT NULL,
  "run_id" uuid NOT NULL,
  "reference" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "loop_event_delivery_loop_key_idx"
  ON "forge"."loop_event_delivery" ("loop_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "loop_event_delivery_team_created_idx"
  ON "forge"."loop_event_delivery" ("team_id", "created_at");
