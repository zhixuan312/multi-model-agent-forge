import { readFileSync } from 'node:fs';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { projectJournal } from '@/db/schema/project-journal';

describe('project journal schema and migration', () => {
  it('models the project_journal table with the required columns and tenancy shape', () => {
    expect(getTableName(projectJournal)).toBe('project_journal');
    const cols = getTableColumns(projectJournal);
    expect(cols.projectId.name).toBe('project_id');
    expect(cols.projectId.notNull).toBe(true);
    expect(cols.heading.notNull).toBe(true);
    expect(cols.body.notNull).toBe(true);
    expect(cols.topic.notNull).toBe(true);
    expect(cols.status.enumValues).toEqual(['proposed', 'kept', 'removed', 'recorded']);
    expect(cols.recordedNodeId.notNull).toBe(false);
    expect(cols.recordedAt.notNull).toBe(false);
    expect(cols).not.toHaveProperty('teamId');
  });

  it('creates the table and ordered index in migration 0018', () => {
    const sql = readFileSync('src/db/migrations/0018_project_journal.sql', 'utf8');
    expect(sql).toContain('CREATE TABLE "forge"."project_journal"');
    expect(sql).toContain('"project_id" uuid NOT NULL');
    expect(sql).toContain('"topic" text NOT NULL');
    expect(sql).toContain('"status" text NOT NULL');
    expect(sql).toContain('ON DELETE cascade');
    expect(sql).toContain('CREATE UNIQUE INDEX "project_journal_project_seq_idx"');
  });
});
