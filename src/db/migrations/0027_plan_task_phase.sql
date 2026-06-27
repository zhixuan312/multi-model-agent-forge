-- Add phase/track grouping to plan tasks (matches superpowers writing-plans tracks)
ALTER TABLE "forge"."project_plan_task" ADD COLUMN "phase" text;
