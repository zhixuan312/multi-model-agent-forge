-- Add approval + participant tracking to plan tasks (matches spec component pattern)
ALTER TABLE "forge"."project_plan_task" ADD COLUMN "approved_by_list" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "forge"."project_plan_task" ADD COLUMN "participants" jsonb NOT NULL DEFAULT '[]'::jsonb;
