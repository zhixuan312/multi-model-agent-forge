import { describe, expect, it } from 'vitest';
import {
  mapActivityRowToEvent,
  recordActivity,
  resolveRunningActivity,
  type ProjectActivityEvent,
} from '@/activity/project-activity';
import { createMockDb } from '../test-utils/mock-db';

describe('project activity core', () => {
  it('records activity rows with idempotent event keys', async () => {
    const db = createMockDb({ 'insert:project_activity': [{ id: 'row-1' }] });
    await recordActivity({
      db,
      projectId: 'p1',
      stage: 'spec',
      phase: 'craft',
      label: 'Drafted spec',
      kind: 'running',
      actor: { id: 'm1', name: 'Avery', tint: '#abc' },
      source: 'user',
      eventKey: 'draft:p1',
    });
    const valuesCall = db._callsFor('project_activity').find((c) => c.method === 'values');
    expect(valuesCall?.args[0]).toMatchObject({
      projectId: 'p1',
      label: 'Drafted spec',
      kind: 'running',
      actorId: 'm1',
      eventKey: 'draft:p1',
    });
    expect(db._assertCalled('project_activity', 'onConflictDoNothing')).toBe(true);
  });

  it('resolves an existing running row in place', async () => {
    const db = createMockDb({ 'update:project_activity': [{ id: 'row-1' }] });
    await resolveRunningActivity({
      db,
      projectId: 'p1',
      eventKey: 'draft:p1',
      status: 'done',
      durationMs: 3200,
      label: 'Drafted spec',
    });
    const setCall = db._callsFor('project_activity').find((c) => c.method === 'set');
    expect(setCall?.args[0]).toMatchObject({ kind: 'done', durationMs: 3200, label: 'Drafted spec' });
  });

  it('maps a DB row into the shared ProjectSummary/UI event shape', () => {
    const event = mapActivityRowToEvent({
      id: 'a1',
      projectId: 'p1',
      seq: 4,
      stage: 'exploration',
      phase: 'discover',
      label: 'Investigated repo-a',
      kind: 'done',
      actorId: 'm1',
      actorName: 'Avery',
      actorTint: '#abc',
      source: 'mma',
      durationMs: 900,
      eventKey: 'discover-task:b1',
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
    });

    expect(event).toEqual<ProjectActivityEvent>({
      id: 'a1',
      seq: 4,
      stage: 'exploration',
      phase: 'discover',
      label: 'Investigated repo-a',
      kind: 'done',
      actorName: 'Avery',
      actorTint: '#abc',
      source: 'mma',
      durationMs: 900,
      eventKey: 'discover-task:b1',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
  });
});
