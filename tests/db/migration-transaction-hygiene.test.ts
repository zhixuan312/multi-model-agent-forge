// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'db', 'migrations');

function migrationFiles(): { name: string; body: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, body: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
}

/**
 * The drizzle migrator runs the whole migration folder inside ONE transaction
 * (`session.transaction(...)` in pg-core's `migrate`). A migration that opens its
 * own `begin` nests it, and its `commit` closes the MIGRATOR's transaction early:
 * Postgres then logs `WARNING 25P01: there is no transaction in progress` when the
 * migrator issues its real COMMIT — which is exactly what every container boot was
 * printing — and, worse, a failure in a later migration can no longer roll the
 * committed one back. Transaction control belongs to the migrator alone.
 */
describe('migration transaction hygiene', () => {
  it('no migration issues its own BEGIN or COMMIT', () => {
    const offenders = migrationFiles()
      .filter(({ body }) => {
        // Strip line comments and `do $$ begin … end $$;` blocks — a PL/pgSQL
        // BEGIN is a block opener, not transaction control.
        const stripped = body
          .replace(/--[^\n]*/g, '')
          .replace(/do\s+\$\$[\s\S]*?\$\$\s*;?/gi, '');
        return /(^|\n)\s*(begin|commit|rollback)\s*;/i.test(stripped);
      })
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });
});

/**
 * 0019 converts `team.workspace_root_path` from an absolute host path to the
 * base-relative leaf, which is what makes a DB dump portable between hosts. A SQL
 * migration cannot read `FORGE_WORKSPACE_BASE`, and does not need to: a team root
 * has always had to be a DIRECT CHILD of the base, so any absolute value is
 * `<some-base>/<leaf>` and the leaf is the base-relative form under any base.
 */
describe('0019 relative workspace_root_path', () => {
  const body = readFileSync(join(MIGRATIONS_DIR, '0019_relative_workspace_root_path.sql'), 'utf8');

  it('rewrites only absolute values, reducing them to their leaf', () => {
    expect(body).toMatch(/UPDATE\s+"forge"\."team"/i);
    expect(body).toContain(`regexp_replace("workspace_root_path", '^.*/', '')`);
    expect(body).toContain(`WHERE "workspace_root_path" LIKE '/%'`);
  });

  it('leaves already-relative values (e.g. the 0005 seed) untouched', () => {
    // The LIKE '/%' guard is what protects `.forge-workspace`.
    expect(body).not.toMatch(/UPDATE[\s\S]*WHERE\s+true/i);
  });

  it('never writes an empty leaf into the NOT NULL column', () => {
    // A trailing-slash value like `/workspace/acme/` has no leaf — skip it rather
    // than blank the column.
    expect(body).toContain(`regexp_replace("workspace_root_path", '^.*/', '') <> ''`);
  });

  it('is registered in the drizzle journal so the migrator actually runs it', () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string; when: number }[] };
    const entry = journal.entries.find((e) => e.tag === '0019_relative_workspace_root_path');
    expect(entry).toBeDefined();
    // Ordering is by `when`; a new migration must sort after every existing one or
    // the migrator skips it on an already-migrated database.
    const others = journal.entries.filter((e) => e.tag !== '0019_relative_workspace_root_path');
    expect(entry!.when).toBeGreaterThan(Math.max(...others.map((e) => e.when)));
  });
});
