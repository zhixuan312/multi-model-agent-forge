-- Collapse consecutive-duplicate BACKFILLED activity rows into one.
--
-- The retired `details.events` store appended a fresh terminal line every time a
-- running action resolved (instead of resolving it in place), so a single logical
-- action — e.g. `spec-auto-draft` ("Drafted spec") — could land as N identical
-- consecutive rows. Migration 0009 backfilled `details.events` verbatim, carrying
-- that noise into `project_activity`.
--
-- The forward path CANNOT produce these: `recordActivity` + `resolveRunningActivity`
-- resolve one running row in place under a unique `event_key`, and singleton handlers
-- (spec-auto-draft, plan-author, …) reject concurrent same-handler dispatch. So this
-- cleanup targets ONLY backfilled rows (`event_key LIKE 'backfill:%'`), and only
-- collapses rows that are ADJACENT (by `seq`) within a project and identical in
-- (stage, phase, label, kind) — a legitimate later repeat separated by other events
-- is preserved. The LAST row of each run is kept (its `created_at`/`duration_ms`
-- reflect the actual completion).
WITH ordered AS (
  SELECT
    id,
    label,
    stage,
    phase,
    kind,
    LEAD(stage) OVER w AS next_stage,
    LEAD(phase) OVER w AS next_phase,
    LEAD(label) OVER w AS next_label,
    LEAD(kind)  OVER w AS next_kind
  FROM "forge"."project_activity"
  WHERE "event_key" LIKE 'backfill:%'
  WINDOW w AS (PARTITION BY "project_id" ORDER BY "seq")
)
DELETE FROM "forge"."project_activity" pa
USING ordered o
WHERE pa.id = o.id
  AND o.stage = o.next_stage
  AND o.phase = o.next_phase
  AND o.label = o.next_label
  AND o.kind  = o.next_kind;
