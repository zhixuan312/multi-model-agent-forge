-- Drop iam_identity.provider. Only `local` auth exists; the column was the
-- external-SSO discriminator and is always 'local', so every query filtered on a
-- constant and every insert wrote a constant. One identity per member is enforced
-- in app code, so identity lookups key on member_id alone. Re-add this column (and
-- the AUTH_PROVIDER enum) if/when external auth lands.
ALTER TABLE "forge"."iam_identity" DROP COLUMN IF EXISTS "provider";
