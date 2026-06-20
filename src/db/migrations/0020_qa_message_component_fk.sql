-- Migrate qa_message from section-level to component-level FK.
-- Drop the old section_id column and index, add component_id.

ALTER TABLE "forge"."project_qa_message" DROP CONSTRAINT IF EXISTS "project_qa_message_section_id_project_component_section_id_fk";
DROP INDEX IF EXISTS "forge"."qa_message_section_seq_idx";

ALTER TABLE "forge"."project_qa_message" DROP COLUMN IF EXISTS "section_id";
ALTER TABLE "forge"."project_qa_message" ADD COLUMN IF NOT EXISTS "component_id" uuid NOT NULL REFERENCES "forge"."project_component"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "qa_message_component_seq_idx" ON "forge"."project_qa_message" ("component_id", "seq");
