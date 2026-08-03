// @vitest-environment node
/**
 * The migrations are HAND-WRITTEN, and this is what keeps that honest.
 *
 * `src/db/migrations/meta/` holds one snapshot — `0000_snapshot.json` — for twenty-two
 * migrations. Every migration from 0001 on was written by hand, additively, which is the
 * deliberate policy (`ALTER TABLE`, never a regenerate-and-replace). `pnpm db:migrate` is
 * correct: `_journal.json` lists all 22, every `.sql` exists, and the checks below show the
 * SQL creates every table and mentions every column the Drizzle schema declares.
 *
 * What that arrangement removes is drizzle-kit's own drift check. `drizzle-kit generate`
 * diffs the schema against the LATEST snapshot, and the latest snapshot is the state after
 * migration 0000 — so it sees eleven tables to drop and five to create, and asks whether
 * each is a rename. Anyone following the ordinary Drizzle workflow (edit schema →
 * `pnpm db:generate` → commit) would produce a migration that drops eleven live tables. The
 * `db:generate` script has been removed for that reason; these assertions replace what it
 * was nominally providing.
 *
 * A new table or column added to the schema without a migration fails here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = 'src/db/migrations';
const SCHEMA_DIR = 'src/db/schema';

const sqlFiles = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const allSql = sqlFiles.map((f) => readFileSync(join(MIG_DIR, f), 'utf8')).join('\n');

const schemaFiles = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.ts'));
const allSchema = schemaFiles.map((f) => readFileSync(join(SCHEMA_DIR, f), 'utf8'));

/** `forge.table('name', { … })` → the table name and its column block. */
function tables(): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  for (const src of allSchema) {
    for (const m of src.matchAll(/forge\.table\(\s*'([^']+)'([\s\S]*?)\n\);/g)) {
      out.push({ name: m[1]!, body: m[2]! });
    }
  }
  return out;
}

/** Every `text('col')` / `uuid('col')` / … column name in a table block. */
function columnsOf(body: string): string[] {
  return [...body.matchAll(/\w+\s*:\s*\w+\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]!);
}

describe('hand-written migrations cover the Drizzle schema', () => {
  const declared = tables();

  it('found the schema and the migrations — a broken scan must not pass vacuously', () => {
    expect(declared.length).toBeGreaterThan(15);
    expect(sqlFiles.length).toBeGreaterThan(15);
    expect(declared.map((t) => t.name)).toContain('project');
  });

  it('every migration in the journal has its .sql file, and vice versa', () => {
    const journal = JSON.parse(readFileSync(join(MIG_DIR, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string }>;
    };
    const tags = journal.entries.map((e) => `${e.tag}.sql`).sort();
    expect(tags).toEqual(sqlFiles);
  });

  it('every table the schema declares is CREATEd by a migration', () => {
    const missing = declared
      .map((t) => t.name)
      .filter((name) => !new RegExp(`CREATE TABLE[^;]*?"?${name}"?`, 'is').test(allSql));
    expect(missing, 'add a migration creating these tables — db:generate cannot do it for you').toEqual([]);
  });

  it('every column the schema declares appears in a migration', () => {
    const missing: string[] = [];
    for (const t of declared) {
      for (const col of columnsOf(t.body)) {
        if (!allSql.includes(`"${col}"`) && !allSql.includes(` ${col} `)) missing.push(`${t.name}.${col}`);
      }
    }
    expect(missing, 'add an ALTER TABLE for these columns').toEqual([]);
  });

  /**
   * The footgun itself. If `db:generate` comes back, it comes back with the snapshots
   * rebuilt — not on its own.
   */
  it('does not offer a db:generate script while the snapshots are incomplete', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    const snapshots = readdirSync(join(MIG_DIR, 'meta')).filter((f) => f.endsWith('_snapshot.json'));
    if (snapshots.length >= sqlFiles.length) return; // snapshots restored — the script is safe again
    expect(
      pkg.scripts['db:generate'],
      'drizzle-kit generate would diff against snapshot 0000 and emit a migration dropping live tables',
    ).toBeUndefined();
  });
});
