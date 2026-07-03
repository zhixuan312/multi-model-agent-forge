-- 0002_qa_message_finalize.sql
-- Phase 6: QA message column finalization
-- Rename component_id → target_id, drop stage_id + sender

-- Rename component_id → target_id
ALTER TABLE forge.project_qa_message RENAME COLUMN component_id TO target_id;

-- Drop unused columns
ALTER TABLE forge.project_qa_message DROP COLUMN IF EXISTS stage_id;
ALTER TABLE forge.project_qa_message DROP COLUMN IF EXISTS sender;

-- Make project_id NOT NULL (all rows backfilled)
ALTER TABLE forge.project_qa_message ALTER COLUMN project_id SET NOT NULL;

-- Redefine index on target_id (was on component_id)
DROP INDEX IF EXISTS forge.qa_message_component_seq_idx;
CREATE INDEX qa_message_target_seq_idx ON forge.project_qa_message(target_id, seq);
