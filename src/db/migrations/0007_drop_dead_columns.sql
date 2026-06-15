-- Drop dead columns surfaced by the Profile/Team-Settings cleanup:
--  * settings_connection.mma_token_ref — the MMA bearer is owned by the local
--    mmagent (read from its auth-token file), never stored by Forge. The DB
--    column + write path were dormant; the bearer is now a single file-only
--    implementation (readMmaBearer / resolveMmaClientConfig).
--  * iam_identity.metadata — an unused external-SSO claims blob (only `local`
--    auth exists), removed with the rest of that seam.
ALTER TABLE "forge"."settings_connection" DROP COLUMN IF EXISTS "mma_token_ref";--> statement-breakpoint
ALTER TABLE "forge"."iam_identity" DROP COLUMN IF EXISTS "metadata";
