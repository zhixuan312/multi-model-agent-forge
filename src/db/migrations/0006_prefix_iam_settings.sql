-- Prefix the Profile/Team-Settings tables for logical grouping (data-preserving
-- RENAMEs — FKs follow the tables), drop the unused external-SSO seam, and
-- enforce the connection-settings singleton.
ALTER TABLE "forge"."member" RENAME TO "iam_member";--> statement-breakpoint
ALTER TABLE "forge"."member_identity" RENAME TO "iam_identity";--> statement-breakpoint
ALTER TABLE "forge"."session" RENAME TO "iam_session";--> statement-breakpoint
ALTER TABLE "forge"."team_settings" RENAME TO "settings_connection";--> statement-breakpoint
ALTER TABLE "forge"."app_secrets" RENAME TO "settings_secret";--> statement-breakpoint
DROP INDEX IF EXISTS "forge"."member_identity_provider_account_uniq";--> statement-breakpoint
ALTER TABLE "forge"."iam_identity" DROP COLUMN IF EXISTS "provider_account_id";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settings_connection_singleton" ON "forge"."settings_connection" ((true));
