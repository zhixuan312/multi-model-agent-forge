-- The role enum (org_admin|team_admin|member) fully supersedes the legacy
-- is_admin boolean; drop the now-unused physical column.
ALTER TABLE forge.team_member DROP COLUMN IF EXISTS is_admin;

-- Enforce the role/team invariant: org_admin has NO team; team_admin and member
-- are each bound to exactly one team.
ALTER TABLE forge.team_member ADD CONSTRAINT team_member_role_team_ck
  CHECK (
    (role = 'org_admin' AND team_id IS NULL)
    OR (role IN ('team_admin', 'member') AND team_id IS NOT NULL)
  );
