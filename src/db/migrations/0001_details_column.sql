-- 0001_details_column.sql
-- Phase 1: Schema + Migration Infrastructure for project details consolidation
-- Hand-authored per project convention (no Drizzle-generated migrations)

-- 1. project table: add details, details_version, details_ready
ALTER TABLE forge.project
  ADD COLUMN IF NOT EXISTS details jsonb,
  ADD COLUMN IF NOT EXISTS details_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS details_ready boolean NOT NULL DEFAULT false;

-- 2. project_qa_message: prep columns (not renamed/dropped yet — Phase 6)
ALTER TABLE forge.project_qa_message
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES forge.project(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS target_kind text;

-- 3. team_spec_template: component definitions (single-tenant, no team_id FK)
CREATE TABLE IF NOT EXISTS forge.team_spec_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL UNIQUE,
  label text NOT NULL,
  order_index integer NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS qa_message_project_idx
  ON forge.project_qa_message(project_id) WHERE project_id IS NOT NULL;
