-- 0004_drop_attachment.sql
-- Remove the project_attachment table. The attachment feature was removed from
-- the app (composer now captures typed text + voice only); attachments will be
-- reintroduced later as a separate design. Targeted single-table drop.
-- DESTRUCTIVE — no rollback after this point.

DROP TABLE IF EXISTS forge.project_attachment CASCADE;
