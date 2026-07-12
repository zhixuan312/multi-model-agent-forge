import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('0009_project_activity.sql', () => {
  it('creates project_activity, seeds Forge, and backfills details.events', () => {
    const sql = readFileSync('src/db/migrations/0009_project_activity.sql', 'utf8');
    expect(sql).toContain('CREATE TABLE "forge"."project_activity"');
    expect(sql).toContain('CREATE INDEX "project_activity_project_seq_idx"');
    expect(sql).toContain('INSERT INTO "forge"."team_member"');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(sql).toContain('backfill:');
    expect(sql).toContain('jsonb_array_elements');
  });
});
