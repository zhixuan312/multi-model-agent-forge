-- 0017_restore_project_denorm_columns.sql
-- The Drizzle project model + code reference completed_at, auto_mode, and auto_note,
-- and 0003's comment assumes they already exist — but the squashed 0000_true_post
-- baseline never created them. Dev/prod DBs kept them from pre-squash history, so the
-- gap only bit clean deployments: project inserts and the automation-resume scan
-- (`... where auto_mode = $1 or details->'automation'->>'status' = 'running'`) failed
-- with `column "completed_at"/"auto_mode"/"auto_note" does not exist`.
--
-- Editing 0000 alone would not help a DB that already applied it (the migrator gates
-- by journal timestamp and never re-runs an applied migration), so this forward
-- migration reconciles every existing DB. IF NOT EXISTS makes it a no-op where the
-- columns already exist (dev/prod). Nullability/defaults match the model exactly.
ALTER TABLE forge.project
  ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS auto_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_note text;
