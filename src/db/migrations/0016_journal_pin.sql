-- Journal recall pins (the journal domain's first DB table) + a supporting index
-- for the auto-derived top-5 FAQ aggregation over recall history.
CREATE TABLE IF NOT EXISTS "forge"."journal_pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer_md" text NOT NULL,
	"citation_ids" text[] DEFAULT '{}' NOT NULL,
	"journal_log_count" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_pin_member_id_team_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."team_member"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_pin_member_idx" ON "forge"."journal_pin" ("member_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_action_log_recall_idx" ON "forge"."ops_action_log" ("created_at" DESC) WHERE "action" = 'journal_recall';
