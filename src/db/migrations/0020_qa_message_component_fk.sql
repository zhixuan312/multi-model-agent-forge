-- Move satisfaction/status fields from section to component level.
-- Add new columns to project_component.
ALTER TABLE "forge"."project_component" ADD COLUMN IF NOT EXISTS "ai_satisfied" boolean NOT NULL DEFAULT false;
ALTER TABLE "forge"."project_component" ADD COLUMN IF NOT EXISTS "human_satisfied" boolean NOT NULL DEFAULT false;
ALTER TABLE "forge"."project_component" ADD COLUMN IF NOT EXISTS "forced" boolean NOT NULL DEFAULT false;
ALTER TABLE "forge"."project_component" ADD COLUMN IF NOT EXISTS "stale" boolean NOT NULL DEFAULT false;

-- Remove satisfaction fields from project_component_section (content only).
ALTER TABLE "forge"."project_component_section" DROP COLUMN IF EXISTS "status";
ALTER TABLE "forge"."project_component_section" DROP COLUMN IF EXISTS "ai_satisfied";
ALTER TABLE "forge"."project_component_section" DROP COLUMN IF EXISTS "human_satisfied";
ALTER TABLE "forge"."project_component_section" DROP COLUMN IF EXISTS "forced";
ALTER TABLE "forge"."project_component_section" DROP COLUMN IF EXISTS "stale";

-- Migrate qa_message from section-level to component-level FK.
ALTER TABLE "forge"."project_qa_message" DROP CONSTRAINT IF EXISTS "project_qa_message_section_id_project_component_section_id_fk";
DROP INDEX IF EXISTS "forge"."qa_message_section_seq_idx";
ALTER TABLE "forge"."project_qa_message" DROP COLUMN IF EXISTS "section_id";
ALTER TABLE "forge"."project_qa_message" ADD COLUMN IF NOT EXISTS "component_id" uuid NOT NULL REFERENCES "forge"."project_component"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "qa_message_component_seq_idx" ON "forge"."project_qa_message" ("component_id", "seq");
