CREATE TABLE "forge"."project_activity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "forge"."project"("id") ON DELETE CASCADE,
  "seq" bigserial NOT NULL,
  "stage" text NOT NULL,
  "phase" text NOT NULL,
  "label" text NOT NULL,
  "kind" text NOT NULL,
  "actor_id" uuid REFERENCES "forge"."team_member"("id") ON DELETE SET NULL,
  "actor_name" text NOT NULL,
  "actor_tint" text NOT NULL,
  "source" text NOT NULL,
  "duration_ms" integer,
  "event_key" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_activity_project_event_key_uniq"
  ON "forge"."project_activity" USING btree ("project_id","event_key")
  WHERE "event_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "project_activity_project_seq_idx"
  ON "forge"."project_activity" USING btree ("project_id","seq");
--> statement-breakpoint
INSERT INTO "forge"."team_member" ("id","username","display_name","avatar_tint","role","team_id")
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'forge',
  'Forge',
  '#9a6b4f',
  'org_admin',
  NULL
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "forge"."project_activity" (
  "project_id",
  "stage",
  "phase",
  "label",
  "kind",
  "actor_id",
  "actor_name",
  "actor_tint",
  "source",
  "duration_ms",
  "event_key",
  "created_at"
)
SELECT
  ordered.project_id,
  ordered.stage,
  ordered.phase,
  ordered.label,
  ordered.kind,
  '00000000-0000-0000-0000-000000000000',
  'Forge',
  '#9a6b4f',
  'mma',
  ordered.duration_ms,
  'backfill:' || ordered.project_id::text || ':' || (ordered.idx - 1)::text,
  ordered.created_at
FROM (
  SELECT
    p.id AS project_id,
    COALESCE(ev.value->>'stage', '') AS stage,
    COALESCE(ev.value->>'phase', '') AS phase,
    COALESCE(ev.value->>'detail', '') AS label,
    CASE COALESCE(ev.value->>'kind', 'action')
      WHEN 'done' THEN 'done'
      WHEN 'error' THEN 'error'
      ELSE 'action'
    END AS kind,
    NULLIF(ev.value->>'durationMs', '')::integer AS duration_ms,
    COALESCE((ev.value->>'at')::timestamptz, now()) AS created_at,
    -- Order by parsed timestamp, then original array position, so the synthetic
    -- index matches chronological order even when legacy `at` values are out of order.
    row_number() OVER (
      PARTITION BY p.id
      ORDER BY COALESCE((ev.value->>'at')::timestamptz, now()) ASC, ev.ordinality ASC
    ) AS idx
  FROM "forge"."project" p
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.details->'events', '[]'::jsonb)) WITH ORDINALITY AS ev(value, ordinality)
) AS ordered
-- Insert in chronological order so the bigserial `seq` (which the readers sort by) is
-- assigned monotonically per project, matching the backfill index.
ORDER BY ordered.project_id, ordered.idx
ON CONFLICT DO NOTHING;
