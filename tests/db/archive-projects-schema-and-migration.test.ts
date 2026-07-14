import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { project } from '@/db/schema/projects';

describe('archive-projects schema and migration', () => {
  it('adds a nullable archivedAt timestamp column to forge.project', () => {
    const cols = getTableColumns(project);
    expect(cols.archivedAt.name).toBe('archived_at');
    expect(cols.archivedAt.notNull).toBe(false);
  });

  it('adds only the archived_at column in the forward migration', () => {
    const sql = readFileSync('src/db/migrations/0013_archive_projects.sql', 'utf8');
    expect(sql).toContain('ALTER TABLE "forge"."project" ADD COLUMN "archived_at" timestamp with time zone;');
    expect(sql).not.toContain('UPDATE "forge"."project"');
    expect(sql).not.toContain('ALTER TABLE "forge"."project" ALTER COLUMN "phase"');
    expect(sql).not.toContain('ALTER TABLE "forge"."project" ALTER COLUMN "visibility"');
  });

  it('registers the new migration in the Drizzle journal', () => {
    const journal = JSON.parse(readFileSync('src/db/migrations/meta/_journal.json', 'utf8'));
    const tags = (journal.entries as Array<{ tag: string }>).map((e) => e.tag);
    expect(tags).toContain('0013_archive_projects');
  });
});
