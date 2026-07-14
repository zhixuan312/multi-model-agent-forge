import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { project } from '@/db/schema/projects';

describe('archive-projects schema and migration', () => {
  it('models archive state as a non-null boolean `archived` column defaulting to false', () => {
    const cols = getTableColumns(project);
    expect(cols.archived.name).toBe('archived');
    expect(cols.archived.notNull).toBe(true);
    expect(cols.archived.hasDefault).toBe(true);
    // The old timestamp column is gone — a project is simply active or archived.
    expect(cols).not.toHaveProperty('archivedAt');
  });

  it('adds the boolean column, backfills from the old timestamp, then drops it', () => {
    const sql = readFileSync('src/db/migrations/0014_archived_boolean.sql', 'utf8');
    expect(sql).toContain('ALTER TABLE "forge"."project" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;');
    expect(sql).toContain('UPDATE "forge"."project" SET "archived" = true WHERE "archived_at" IS NOT NULL;');
    expect(sql).toContain('ALTER TABLE "forge"."project" DROP COLUMN "archived_at";');
  });

  it('registers the boolean migration in the Drizzle journal', () => {
    const journal = JSON.parse(readFileSync('src/db/migrations/meta/_journal.json', 'utf8'));
    const tags = (journal.entries as Array<{ tag: string }>).map((e) => e.tag);
    expect(tags).toContain('0014_archived_boolean');
  });
});
