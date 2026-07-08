begin;

-- Precondition check: ensure at least one legacy admin exists
do $$
begin
  if (select count(*) from forge.team_member where is_admin = true) = 0 then
    raise exception '0005_multi_tenancy requires at least one legacy is_admin member';
  end if;
end $$;

-- Create the tenant team table
create table forge.team (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  workspace_root_path text not null,
  git_token_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add role and team_id columns to team_member (nullable for backfill)
alter table forge.team_member add column role text;
alter table forge.team_member add column team_id uuid references forge.team(id);

-- Add team_id to tenant-owned tables (nullable for backfill)
alter table forge.project add column team_id uuid references forge.team(id);
alter table forge.workspace_repo add column team_id uuid references forge.team(id);
alter table forge.ops_mma_batch add column team_id uuid references forge.team(id);
alter table forge.loop_def add column team_id uuid references forge.team(id);
alter table forge.loop_run add column team_id uuid references forge.team(id);

-- Insert the default team (workspace root configured via application env vars or defaults, git token from existing connection)
insert into forge.team (name, slug, workspace_root_path, git_token_ref, created_at, updated_at)
values (
  'Default Team',
  'default-team',
  '.forge-workspace',
  (select git_token_ref from forge.team_connection limit 1),
  now(),
  now()
);

-- Backfill all tenant-owned rows to the default team
update forge.project set team_id = (select id from forge.team where slug = 'default-team' limit 1) where team_id is null;
update forge.workspace_repo set team_id = (select id from forge.team where slug = 'default-team' limit 1) where team_id is null;
update forge.ops_mma_batch set team_id = (select id from forge.team where slug = 'default-team' limit 1) where team_id is null;
update forge.loop_def set team_id = (select id from forge.team where slug = 'default-team' limit 1) where team_id is null;
update forge.loop_run set team_id = (select id from forge.team where slug = 'default-team' limit 1) where team_id is null;

-- Backfill roles: earliest legacy admin -> org_admin, rest -> role based on is_admin
update forge.team_member set role = 'org_admin', team_id = null
where is_admin = true and created_at = (select min(created_at) from forge.team_member where is_admin = true);

update forge.team_member set role = 'team_admin', team_id = (select id from forge.team where slug = 'default-team' limit 1)
where is_admin = true and role is null;

update forge.team_member set role = 'member', team_id = (select id from forge.team where slug = 'default-team' limit 1)
where is_admin = false and role is null;

-- Make team_id NOT NULL on tenant-owned tables
alter table forge.project alter column team_id set not null;
alter table forge.workspace_repo alter column team_id set not null;
alter table forge.ops_mma_batch alter column team_id set not null;
alter table forge.loop_def alter column team_id set not null;
alter table forge.loop_run alter column team_id set not null;

-- Make role NOT NULL on team_member
alter table forge.team_member alter column role set not null;

-- Remove git_token_ref from org-owned connection table (it moves to team.git_token_ref)
alter table forge.team_connection drop column if exists git_token_ref;

-- Create index on team_id + created_at for efficient usage aggregation
create index mma_batch_team_created_idx on forge.ops_mma_batch (team_id, created_at);
create index workspace_repo_team_idx on forge.workspace_repo (team_id);
create index project_team_idx on forge.project (team_id);
create index loop_def_team_idx on forge.loop_def (team_id);
create index loop_run_team_idx on forge.loop_run (team_id);

-- Add unique constraint for repo name per team
alter table forge.workspace_repo add constraint workspace_repo_team_name_uniq unique (team_id, name);

-- Final assertion: exactly one org_admin exists and is reachable
do $$
begin
  if (select count(*) from forge.team_member where role = 'org_admin') <> 1 then
    raise exception 'Migration failed: exactly one org_admin must exist after migration';
  end if;
end $$;

commit;
