CREATE TABLE "forge"."project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"intent_md" text,
	"owner_id" uuid NOT NULL,
	"visibility" text NOT NULL,
	"phase" text DEFAULT 'design' NOT NULL,
	"current_stage" text,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_member" (
	"project_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "project_member_project_id_member_id_pk" PRIMARY KEY("project_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "forge"."project_repo" (
	"project_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	CONSTRAINT "project_repo_project_id_repo_id_pk" PRIMARY KEY("project_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "forge"."stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "stage_project_kind_uniq" UNIQUE("project_id","kind")
);
--> statement-breakpoint
CREATE TABLE "forge"."action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"member_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forge"."project" ADD CONSTRAINT "project_owner_id_member_id_fk" FOREIGN KEY ("owner_id") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_member" ADD CONSTRAINT "project_member_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_repo" ADD CONSTRAINT "project_repo_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_repo" ADD CONSTRAINT "project_repo_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "forge"."repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."stage" ADD CONSTRAINT "stage_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."action_log" ADD CONSTRAINT "action_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."action_log" ADD CONSTRAINT "action_log_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_owner_idx" ON "forge"."project" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "project_phase_idx" ON "forge"."project" USING btree ("phase");--> statement-breakpoint
CREATE INDEX "project_updated_idx" ON "forge"."project" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "action_log_project_created_idx" ON "forge"."action_log" USING btree ("project_id","created_at" DESC NULLS LAST);