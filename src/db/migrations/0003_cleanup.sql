-- 0003_cleanup.sql
-- Drop absorbed tables whose data now lives in project.details.
-- Project columns (phase, current_stage, auto_mode, auto_note, intent_md,
-- brief_md, details_ready) are KEPT as denormalized fields synced from details.
-- DESTRUCTIVE — no rollback after this point.

-- Drop absorbed tables (order: children before parents due to FK cascades)
DROP TABLE IF EXISTS forge.project_exploration_task CASCADE;
DROP TABLE IF EXISTS forge.project_component_section CASCADE;
DROP TABLE IF EXISTS forge.project_component CASCADE;
DROP TABLE IF EXISTS forge.project_participant CASCADE;
DROP TABLE IF EXISTS forge.project_audit_pass CASCADE;
DROP TABLE IF EXISTS forge.project_plan_task CASCADE;
DROP TABLE IF EXISTS forge.project_repo CASCADE;
DROP TABLE IF EXISTS forge.project_learning_candidate CASCADE;
DROP TABLE IF EXISTS forge.project_stage CASCADE;
