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
    expect(journalEntries().map((e) => e.tag)).toContain('0019_relative_workspace_root_path');
  });
});

/** The drizzle journal, ordered as written. */
function journalEntries(): { idx: number; tag: string; when: number }[] {
  return (
    JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string; when: number }[];
    }
  ).entries;
}

/**
 * The journal invariant itself, not a snapshot of it.
 *
 * This assertion used to be pinned to 0019 — "0019's `when` is greater than every other
 * entry's" — which held only while 0019 happened to be the newest migration. Adding 0020
 * broke it, even though 0020 was registered correctly. A test that encodes "the current
 * last migration is last" fails on every legitimate addition and teaches people to edit the
 * assertion rather than check the rule. The rule is what matters: the migrator orders by
 * `when`, so an entry that does not sort after the ones before it is silently skipped on an
 * already-migrated database.
 */
describe('drizzle journal ordering', () => {
  it('every migration sorts strictly after the one before it', () => {
    const entries = journalEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (let i = 1; i < entries.length; i++) {
      expect(
        entries[i].when,
        `${entries[i].tag} must sort after ${entries[i - 1].tag}`,
      ).toBeGreaterThan(entries[i - 1].when);
    }
  });

  it('idx is dense, zero-based and matches the file order', () => {
    journalEntries().forEach((e, i) => expect(e.idx).toBe(i));
  });

  it('every journal tag has a matching .sql file, and every .sql file is registered', () => {
    // Either half missing is a silent no-op: an unregistered file never runs, and a
    // registered-but-absent tag makes the migrator throw at boot.
    const tags = new Set(journalEntries().map((e) => e.tag));
    const files = new Set(
      readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')),
    );
    expect([...tags].filter((t) => !files.has(t))).toEqual([]);
    expect([...files].filter((f) => !tags.has(f))).toEqual([]);
  });
});
