CREATE TABLE "forge"."mma_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"route" text NOT NULL,
	"target_repo_id" uuid,
	"cwd" text NOT NULL,
	"batch_id" text,
	"status" text DEFAULT 'dispatched' NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"dispatched_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminal_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forge"."attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."exploration_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_repo_id" uuid,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"mma_batch_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forge"."mma_batch" ADD CONSTRAINT "mma_batch_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."mma_batch" ADD CONSTRAINT "mma_batch_target_repo_id_repo_id_fk" FOREIGN KEY ("target_repo_id") REFERENCES "forge"."repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."mma_batch" ADD CONSTRAINT "mma_batch_dispatched_by_member_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."attachment" ADD CONSTRAINT "attachment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."attachment" ADD CONSTRAINT "attachment_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."exploration_task" ADD CONSTRAINT "exploration_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."exploration_task" ADD CONSTRAINT "exploration_task_target_repo_id_repo_id_fk" FOREIGN KEY ("target_repo_id") REFERENCES "forge"."repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."exploration_task" ADD CONSTRAINT "exploration_task_mma_batch_id_mma_batch_id_fk" FOREIGN KEY ("mma_batch_id") REFERENCES "forge"."mma_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."exploration_task" ADD CONSTRAINT "exploration_task_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mma_batch_project_created_idx" ON "forge"."mma_batch" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "mma_batch_batch_id_idx" ON "forge"."mma_batch" USING btree ("batch_id");