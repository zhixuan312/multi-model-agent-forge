CREATE TABLE "forge"."team_secret" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"value_enc" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."team_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mma_base_url" text,
	"git_token_ref" text,
	"openai_transcription_key_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."team_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_tint" text DEFAULT '#9a6b4f' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."team_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."team_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."workspace_repo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"path_on_disk" text NOT NULL,
	"default_branch" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"head_sha" text,
	"status" text DEFAULT 'cloned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_repo_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "forge"."project_build_pr" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"url" text NOT NULL,
	"branch" text NOT NULL,
	"target_branch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_pr_project_repo_uniq" UNIQUE("project_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "forge"."project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"intent_md" text,
	"brief_md" text,
	"owner_id" uuid NOT NULL,
	"visibility" text NOT NULL,
	"phase" text DEFAULT 'design' NOT NULL,
	"current_stage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_repo" (
	"project_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	CONSTRAINT "project_repo_project_id_repo_id_pk" PRIMARY KEY("project_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "forge"."project_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_phase" text,
	CONSTRAINT "stage_project_kind_uniq" UNIQUE("project_id","kind")
);
--> statement-breakpoint
CREATE TABLE "forge"."project_participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"primary_roles" text[] NOT NULL,
	"status" text DEFAULT 'gathering' NOT NULL,
	"ai_satisfied" boolean DEFAULT false NOT NULL,
	"human_satisfied" boolean DEFAULT false NOT NULL,
	"forced" boolean DEFAULT false NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"mma_session_id" text,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_component_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_qa_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid,
	"stage_id" uuid,
	"seq" integer NOT NULL,
	"sender" text NOT NULL,
	"body_md" text NOT NULL,
	"meta" jsonb,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_audit_pass" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"pass_no" integer NOT NULL,
	"findings_count" integer NOT NULL,
	"verdict" text NOT NULL,
	"mma_batch_id" uuid,
	"context_block_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_exploration_task" (
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
CREATE TABLE "forge"."project_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"artifact_kind" text NOT NULL,
	"artifact_version" integer,
	"format" text NOT NULL,
	"file_path" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_plan_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"phase" text,
	"target_repo_id" uuid NOT NULL,
	"is_write" boolean DEFAULT true NOT NULL,
	"depends_on" uuid[],
	"order_index" integer NOT NULL,
	"review_policy" text DEFAULT 'reviewed' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"branch" text,
	"target_branch" text,
	"commit_sha" text,
	"fix_note" text,
	"meta" jsonb,
	"mma_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."project_learning_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"body_md" text NOT NULL,
	"type" text NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"recorded_node_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."ops_action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"member_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."ops_mma_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"route" text NOT NULL,
	"target_repo_id" uuid,
	"cwd" text NOT NULL,
	"batch_id" text,
	"status" text DEFAULT 'dispatched' NOT NULL,
	"handler" text,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"dispatched_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminal_at" timestamp with time zone,
	"cost_usd" numeric,
	"saved_vs_main_usd" numeric,
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"implementer_model" text,
	"reviewer_model" text,
	"implementer_tier" text,
	"loop_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "forge"."ops_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"source_id" text,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."loop_def" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"worker_tier" text DEFAULT 'complex' NOT NULL,
	"cron" text,
	"target_branch" text,
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
	"verification" jsonb,
	"files_changed" jsonb,
	"journal_entries" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forge"."journal_pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer_md" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citation_ids" text[] DEFAULT '{}' NOT NULL,
	"journal_log_count" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forge"."team_secret" ADD CONSTRAINT "team_secret_created_by_team_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."team_identity" ADD CONSTRAINT "team_identity_member_id_team_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."team_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."team_session" ADD CONSTRAINT "team_session_member_id_team_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."team_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_build_pr" ADD CONSTRAINT "project_build_pr_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_build_pr" ADD CONSTRAINT "project_build_pr_repo_id_workspace_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "forge"."workspace_repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project" ADD CONSTRAINT "project_owner_id_team_member_id_fk" FOREIGN KEY ("owner_id") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_repo" ADD CONSTRAINT "project_repo_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_repo" ADD CONSTRAINT "project_repo_repo_id_workspace_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "forge"."workspace_repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_stage" ADD CONSTRAINT "project_stage_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_participant" ADD CONSTRAINT "project_participant_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_participant" ADD CONSTRAINT "project_participant_member_id_team_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_component" ADD CONSTRAINT "project_component_stage_id_project_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "forge"."project_stage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_component_section" ADD CONSTRAINT "project_component_section_component_id_project_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "forge"."project_component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_qa_message" ADD CONSTRAINT "project_qa_message_component_id_project_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "forge"."project_component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_qa_message" ADD CONSTRAINT "project_qa_message_stage_id_project_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "forge"."project_stage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_qa_message" ADD CONSTRAINT "project_qa_message_author_id_team_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_audit_pass" ADD CONSTRAINT "project_audit_pass_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_attachment" ADD CONSTRAINT "project_attachment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_attachment" ADD CONSTRAINT "project_attachment_created_by_team_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_exploration_task" ADD CONSTRAINT "project_exploration_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_exploration_task" ADD CONSTRAINT "project_exploration_task_target_repo_id_workspace_repo_id_fk" FOREIGN KEY ("target_repo_id") REFERENCES "forge"."workspace_repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_exploration_task" ADD CONSTRAINT "project_exploration_task_mma_batch_id_ops_mma_batch_id_fk" FOREIGN KEY ("mma_batch_id") REFERENCES "forge"."ops_mma_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_exploration_task" ADD CONSTRAINT "project_exploration_task_created_by_team_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_export" ADD CONSTRAINT "project_export_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_plan_task" ADD CONSTRAINT "project_plan_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_plan_task" ADD CONSTRAINT "project_plan_task_target_repo_id_workspace_repo_id_fk" FOREIGN KEY ("target_repo_id") REFERENCES "forge"."workspace_repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_plan_task" ADD CONSTRAINT "project_plan_task_mma_batch_id_ops_mma_batch_id_fk" FOREIGN KEY ("mma_batch_id") REFERENCES "forge"."ops_mma_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_learning_candidate" ADD CONSTRAINT "project_learning_candidate_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."project_learning_candidate" ADD CONSTRAINT "project_learning_candidate_created_by_team_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."ops_action_log" ADD CONSTRAINT "ops_action_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."ops_action_log" ADD CONSTRAINT "ops_action_log_member_id_team_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."ops_mma_batch" ADD CONSTRAINT "ops_mma_batch_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."ops_mma_batch" ADD CONSTRAINT "ops_mma_batch_target_repo_id_workspace_repo_id_fk" FOREIGN KEY ("target_repo_id") REFERENCES "forge"."workspace_repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."ops_mma_batch" ADD CONSTRAINT "ops_mma_batch_dispatched_by_team_member_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."ops_notification" ADD CONSTRAINT "ops_notification_member_id_team_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."team_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."loop_def" ADD CONSTRAINT "loop_def_created_by_team_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."team_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."loop_run" ADD CONSTRAINT "loop_run_loop_id_loop_def_id_fk" FOREIGN KEY ("loop_id") REFERENCES "forge"."loop_def"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."loop_run" ADD CONSTRAINT "loop_run_repo_id_workspace_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "forge"."workspace_repo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."loop_run" ADD CONSTRAINT "loop_run_mma_batch_id_ops_mma_batch_id_fk" FOREIGN KEY ("mma_batch_id") REFERENCES "forge"."ops_mma_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."journal_pin" ADD CONSTRAINT "journal_pin_member_id_team_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."team_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "settings_connection_singleton" ON "forge"."team_connection" USING btree ((true));--> statement-breakpoint
CREATE UNIQUE INDEX "member_username_lower_uniq" ON "forge"."team_member" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "member_identity_member_idx" ON "forge"."team_identity" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "session_member_idx" ON "forge"."team_session" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "session_token_idx" ON "forge"."team_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "repo_tags_gin" ON "forge"."workspace_repo" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "build_pr_project_idx" ON "forge"."project_build_pr" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_owner_idx" ON "forge"."project" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "project_phase_idx" ON "forge"."project" USING btree ("phase");--> statement-breakpoint
CREATE INDEX "project_updated_idx" ON "forge"."project" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "participant_project_scope_idx" ON "forge"."project_participant" USING btree ("project_id","scope");--> statement-breakpoint
CREATE INDEX "participant_member_idx" ON "forge"."project_participant" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_dedup_idx" ON "forge"."project_participant" USING btree ("project_id","member_id","scope",COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'),"role");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_sole_owner_idx" ON "forge"."project_participant" USING btree ("project_id") WHERE "forge"."project_participant"."scope" = 'project' AND "forge"."project_participant"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "component_stage_idx" ON "forge"."project_component" USING btree ("stage_id","order_index");--> statement-breakpoint
CREATE INDEX "component_section_component_idx" ON "forge"."project_component_section" USING btree ("component_id","order_index");--> statement-breakpoint
CREATE INDEX "qa_message_component_seq_idx" ON "forge"."project_qa_message" USING btree ("component_id","seq");--> statement-breakpoint
CREATE INDEX "audit_pass_project_idx" ON "forge"."project_audit_pass" USING btree ("project_id","pass_no");--> statement-breakpoint
CREATE INDEX "export_project_idx" ON "forge"."project_export" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plan_task_project_order_idx" ON "forge"."project_plan_task" USING btree ("project_id","order_index");--> statement-breakpoint
CREATE INDEX "plan_task_repo_idx" ON "forge"."project_plan_task" USING btree ("target_repo_id");--> statement-breakpoint
CREATE INDEX "plan_task_status_idx" ON "forge"."project_plan_task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "learning_candidate_project_idx" ON "forge"."project_learning_candidate" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "action_log_project_created_idx" ON "forge"."ops_action_log" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mma_batch_project_created_idx" ON "forge"."ops_mma_batch" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "mma_batch_batch_id_idx" ON "forge"."ops_mma_batch" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "mma_batch_loop_run_idx" ON "forge"."ops_mma_batch" USING btree ("loop_run_id");--> statement-breakpoint
CREATE INDEX "notification_member_feed_idx" ON "forge"."ops_notification" USING btree ("member_id","dismissed_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_source_dedup_idx" ON "forge"."ops_notification" USING btree ("source_id") WHERE "forge"."ops_notification"."source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "loop_enabled_idx" ON "forge"."loop_def" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "loop_run_loop_started_idx" ON "forge"."loop_run" USING btree ("loop_id","started_at");--> statement-breakpoint
CREATE INDEX "loop_run_run_id_idx" ON "forge"."loop_run" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "journal_pin_member_idx" ON "forge"."journal_pin" USING btree ("member_id","created_at" DESC NULLS LAST);