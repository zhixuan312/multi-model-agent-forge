CREATE TABLE "forge"."agent_tier" (
	"tier" text PRIMARY KEY NOT NULL,
	"provider_id" uuid,
	"model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."provider" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"base_url" text,
	"api_key_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "forge"."team_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mma_base_url" text,
	"mma_token_ref" text,
	"git_token_ref" text,
	"openai_transcription_key_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."repo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"path_on_disk" text NOT NULL,
	"default_branch" text NOT NULL,
	"kind" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"head_sha" text,
	"status" text DEFAULT 'cloned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "forge"."agent_tier" ADD CONSTRAINT "agent_tier_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "forge"."provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_tags_gin" ON "forge"."repo" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "repo_kind_idx" ON "forge"."repo" USING btree ("kind");