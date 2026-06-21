ALTER TABLE forge.project_plan_task ADD COLUMN target_branch text;
ALTER TABLE forge.project ADD COLUMN build_prs jsonb DEFAULT '{}';
