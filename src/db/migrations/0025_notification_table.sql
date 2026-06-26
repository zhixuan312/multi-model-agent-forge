CREATE TABLE IF NOT EXISTS "forge"."ops_notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "member_id" uuid REFERENCES "forge"."team_member"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "subtitle" text,
  "source_id" text,
  "read_at" timestamp with time zone,
  "dismissed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "notification_member_feed_idx" ON "forge"."ops_notification" ("member_id", "dismissed_at", "created_at" DESC);
CREATE UNIQUE INDEX "notification_source_dedup_idx" ON "forge"."ops_notification" ("source_id") WHERE "source_id" IS NOT NULL;
