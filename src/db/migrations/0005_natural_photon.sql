CREATE TABLE "forge"."export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"artifact_id" uuid,
	"format" text NOT NULL,
	"file_path" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."plan_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"target_repo_id" uuid NOT NULL,
	"is_write" boolean DEFAULT true NOT NULL,
	"depends_on" uuid[],
	"order_index" integer NOT NULL,
	"review_policy" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"branch" text,
	"commit_sha" text,
	"fix_note" text,
	"meta" jsonb,
	"mma_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forge"."export" ADD CONSTRAINT "export_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."plan_task" ADD CONSTRAINT "plan_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."plan_task" ADD CONSTRAINT "plan_task_target_repo_id_repo_id_fk" FOREIGN KEY ("target_repo_id") REFERENCES "forge"."repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."plan_task" ADD CONSTRAINT "plan_task_mma_batch_id_mma_batch_id_fk" FOREIGN KEY ("mma_batch_id") REFERENCES "forge"."mma_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_project_idx" ON "forge"."export" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plan_task_project_order_idx" ON "forge"."plan_task" USING btree ("project_id","order_index");--> statement-breakpoint
CREATE INDEX "plan_task_repo_idx" ON "forge"."plan_task" USING btree ("target_repo_id");--> statement-breakpoint
CREATE INDEX "plan_task_status_idx" ON "forge"."plan_task" USING btree ("status");