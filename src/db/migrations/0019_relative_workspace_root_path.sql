-- Make `team.workspace_root_path` host-portable.
--
-- The column used to hold an ABSOLUTE host path (`/root/forge-workspace`,
-- `/workspace/acme`). That makes a database dump unusable on another host: restore
-- a VIP backup into the container, whose FORGE_WORKSPACE_BASE is `/workspace`, and
-- every team points at a directory that does not exist there AND fails the
-- "direct child of the operator base" validation — the journal and project
-- artifacts stop resolving until someone hand-rewrites the rows.
--
-- The column now stores the path RELATIVE to the base (the team's leaf directory),
-- and `resolveTeamWorkspaceRoot()` joins it onto FORGE_WORKSPACE_BASE at runtime.
--
-- Why the leaf, and not "strip the configured base": a SQL migration cannot read
-- FORGE_WORKSPACE_BASE. It does not need to. Validation has always required a team
-- root to be a DIRECT CHILD of the base, so any absolute value is `<some-base>/<leaf>`
-- and the leaf IS the base-relative form — whichever base wrote it. Rows already
-- relative (e.g. the `.forge-workspace` seeded by 0005) are left untouched.
--
-- Note the runtime resolver still accepts an absolute stored value verbatim, so an
-- unconverted or hand-edited row keeps working; this migration only removes the
-- host coupling from the rows we control.

UPDATE "forge"."team"
SET "workspace_root_path" = regexp_replace("workspace_root_path", '^.*/', ''),
    "updated_at" = now()
WHERE "workspace_root_path" LIKE '/%'
  AND regexp_replace("workspace_root_path", '^.*/', '') <> '';
