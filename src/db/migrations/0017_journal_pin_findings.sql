-- Persist the per-learning breakdown on a pin so a pinned answer renders at the
-- same fidelity as the live recall (synthesis + learnings + sources), not a
-- degraded synthesis-only view.
ALTER TABLE "forge"."journal_pin" ADD COLUMN "findings" jsonb DEFAULT '[]'::jsonb NOT NULL;
