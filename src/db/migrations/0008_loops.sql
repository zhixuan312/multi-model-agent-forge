-- Loops feature (admin-only, cron-scheduled goal-driven jobs).
-- loop = config; loop_run = per-(repo, fire) outcome. mma_batch.project_id is
-- made nullable so a loop dispatch (team-level, not project-scoped) can reuse it.
ALTER TABLE "forge"."mma_batch" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
CREATE TABLE "forge"."loop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"worker_tier" text DEFAULT 'complex' NOT NULL,
	"cron" text NOT NULL,
	"repo_ids" uuid[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."loop_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loop_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"branch" text,
	"pr_url" text,
	"mma_batch_id" uuid,
	"key_changes" jsonb,
	"journal_entries" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "forge"."loop" ADD CONSTRAINT "loop_created_by_iam_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."iam_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."loop_run" ADD CONSTRAINT "loop_run_loop_id_loop_id_fk" FOREIGN KEY ("loop_id") REFERENCES "forge"."loop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."loop_run" ADD CONSTRAINT "loop_run_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "forge"."repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."loop_run" ADD CONSTRAINT "loop_run_mma_batch_id_mma_batch_id_fk" FOREIGN KEY ("mma_batch_id") REFERENCES "forge"."mma_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loop_enabled_idx" ON "forge"."loop" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "loop_run_loop_started_idx" ON "forge"."loop_run" USING btree ("loop_id","started_at");--> statement-breakpoint
CREATE INDEX "loop_run_run_id_idx" ON "forge"."loop_run" USING btree ("run_id");
