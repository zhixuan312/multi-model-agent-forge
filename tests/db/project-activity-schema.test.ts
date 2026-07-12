import { describe, expect, it } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { projectActivity } from '@/db/schema/activity';
import * as schema from '@/db/schema';

describe('project_activity schema', () => {
  it('exposes the frozen table name and columns', () => {
    expect(getTableName(projectActivity)).toBe('project_activity');
    const cols = getTableColumns(projectActivity);
    expect(Object.keys(cols)).toEqual([
      'id',
      'projectId',
      'seq',
      'stage',
      'phase',
      'label',
      'kind',
      'actorId',
      'actorName',
      'actorTint',
      'source',
      'durationMs',
      'eventKey',
      'createdAt',
    ]);
    expect(cols.kind.enumValues).toEqual(['action', 'running', 'done', 'error']);
    expect(cols.source.enumValues).toEqual(['user', 'mma']);
  });

  it('is re-exported from the schema barrel', () => {
    expect(schema.projectActivity).toBe(projectActivity);
  });
});
