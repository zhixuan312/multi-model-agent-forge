-- Drop repo.kind. It was a free-form single-value classifier that overlapped
-- entirely with the multi-value `tags` (both free-form, both filter axes), and
-- nothing branched on it: the Workspace + RepoPicker now classify repos with
-- tags only, and the build pipeline detects a repo's language/ecosystem from its
-- manifest files (package.json / pyproject.toml), never from this column.
-- Dropping the column also drops its dependent index automatically.
DROP INDEX IF EXISTS "forge"."repo_kind_idx";--> statement-breakpoint
ALTER TABLE "forge"."repo" DROP COLUMN IF EXISTS "kind";
