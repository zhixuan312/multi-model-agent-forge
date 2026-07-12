import { describe, expect, it, vi } from 'vitest';
import { loadProjectSummary } from '@/projects/project-summary';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', () => ({
  readSpecFile: vi.fn().mockResolvedValue({ version: 5, bodyMd: '' }),
  readPlanFile: vi.fn().mockResolvedValue({ version: 3, bodyMd: '' }),
}));

describe('loadProjectSummary project_activity rows', () => {
  it('maps project_activity rows into the shared event shape', async () => {
    const db = createMockDb({
      'select:project': [{ name: 'Demo', createdAt: new Date('2026-06-01'), completedAt: null, details: null }],
      'select:ops_mma_batch': [],
      'select:project_activity': [{
        id: 'a1',
        projectId: 'proj-1',
        seq: 1,
        stage: 'spec',
        phase: 'craft',
        label: 'Drafted spec',
        kind: 'done',
        actorId: 'm1',
        actorName: 'Avery',
        actorTint: '#09f',
        source: 'mma',
        durationMs: 1200,
        eventKey: 'spec-auto-draft:batch-1',
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
      }],
    });
    const summary = await loadProjectSummary(db, 'proj-1');
    expect(summary.events[0]).toEqual({
      id: 'a1',
      seq: 1,
      stage: 'spec',
      phase: 'craft',
      label: 'Drafted spec',
      kind: 'done',
      actorName: 'Avery',
      actorTint: '#09f',
      source: 'mma',
      durationMs: 1200,
      eventKey: 'spec-auto-draft:batch-1',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
  });
});
