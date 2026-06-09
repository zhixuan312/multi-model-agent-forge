CREATE TABLE "forge"."member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_tint" text DEFAULT '#9a6b4f' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."member_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forge"."app_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"value_enc" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forge"."member_identity" ADD CONSTRAINT "member_identity_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."session" ADD CONSTRAINT "session_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "forge"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forge"."app_secrets" ADD CONSTRAINT "app_secrets_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "forge"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_username_lower_uniq" ON "forge"."member" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "member_identity_provider_account_uniq" ON "forge"."member_identity" USING btree ("provider","provider_account_id") WHERE "forge"."member_identity"."provider_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "member_identity_member_idx" ON "forge"."member_identity" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "session_member_idx" ON "forge"."session" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "session_token_idx" ON "forge"."session" USING btree ("token_hash");