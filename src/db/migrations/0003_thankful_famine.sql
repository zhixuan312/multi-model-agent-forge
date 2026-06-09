CREATE TABLE "forge"."component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"primary_roles" text[] NOT NULL,
	"status" text DEFAULT 'gathering' NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."component_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'gathering' NOT NULL,
	"ai_satisfied" boolean DEFAULT false NOT NULL,
	"human_satisfied" boolean DEFAULT false NOT NULL,
	"forced" boolean DEFAULT false NOT NULL,
	"draft_md" text,
	"stale" boolean DEFAULT false NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."qa_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"sender" text NOT NULL,
	"body_md" text NOT NULL,
	"meta" jsonb,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body_md" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."audit_pass" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"pass_no" integer NOT NULL,
	"findings_count" integer NOT NULL,
	"verdict" text NOT NULL,
	"mma_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."learning_candidate" (
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
ALTER TABLE "forge"."component" ADD CONSTRAINT "component_stage_id_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "forge"."stage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."component_section" ADD CONSTRAINT "component_section_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "forge"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."qa_message" ADD CONSTRAINT "qa_message_section_id_component_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "forge"."component_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."qa_message" ADD CONSTRAINT "qa_message_author_id_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."artifact" ADD CONSTRAINT "artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."artifact" ADD CONSTRAINT "artifact_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."audit_pass" ADD CONSTRAINT "audit_pass_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."learning_candidate" ADD CONSTRAINT "learning_candidate_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "forge"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."learning_candidate" ADD CONSTRAINT "learning_candidate_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "component_stage_idx" ON "forge"."component" USING btree ("stage_id","order_index");--> statement-breakpoint
CREATE INDEX "component_section_component_idx" ON "forge"."component_section" USING btree ("component_id","order_index");--> statement-breakpoint
CREATE INDEX "qa_message_section_seq_idx" ON "forge"."qa_message" USING btree ("section_id","seq");--> statement-breakpoint
CREATE INDEX "artifact_project_kind_version_idx" ON "forge"."artifact" USING btree ("project_id","kind","version" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_pass_project_idx" ON "forge"."audit_pass" USING btree ("project_id","pass_no");--> statement-breakpoint
CREATE INDEX "learning_candidate_project_idx" ON "forge"."learning_candidate" USING btree ("project_id");