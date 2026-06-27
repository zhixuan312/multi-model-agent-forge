import { describe, it, expect } from 'vitest';
import { buildAutoDraftRequest, buildRefineRequest } from '@/spec/auto-draft';
import { createMockDb } from '../test-utils/mock-db';

const projectId = 'proj-1';

describe('buildAutoDraftRequest', () => {
  it('returns error when no spec stage exists', async () => {
    const mockDb = createMockDb({
      'select:project': [{ intentMd: 'test' }],
      'select:project_stage': [],
    });

    const result = await buildAutoDraftRequest({ db: mockDb, projectId });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBe('No spec stage.');
    }
  });

  it('returns system + user + outline when spec stage and sections exist', async () => {
    const stageId = 'stage-1';
    const comp1Id = 'comp-1';
    const mockDb = createMockDb({
      'select:project': [{ intentMd: 'Remove DB from demo' }],
      'select:project_stage': [{ id: stageId }],
      'select:project_component': [
        { id: comp1Id, kind: 'context', orderIndex: 0, status: 'gathering' },
      ],
      'select:project_component_section': [
        { id: 'sec-1', componentId: comp1Id, key: 'background', label: 'Background', orderIndex: 0 },
      ],
    });

    const result = await buildAutoDraftRequest({ db: mockDb, projectId });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.system).toContain('specification drafter');
      expect(result.user).toContain('Remove DB from demo');
      expect(result.outline).toHaveLength(1);
      expect(result.outline[0].componentKind).toBe('context');
      expect(result.outline[0].sectionKey).toBe('background');
    }
  });
});

describe('buildRefineRequest', () => {
  it('returns error when component not found', async () => {
    const mockDb = createMockDb({
      'select:project_component': [],
    });

    const result = await buildRefineRequest({
      db: mockDb,
      componentId: 'nonexistent',
      userAnswer: 'some feedback',
      history: [],
    });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBe('Component not found.');
    }
  });

  it('returns system + user prompts for a valid component', async () => {
    const mockDb = createMockDb({
      'select:project_component': [
        { id: 'comp-1', stageId: 'stage-1', kind: 'context', status: 'drafted' },
      ],
      'select:project_stage': [{ projectId: 'proj-1' }],
      'select:project_component_section': [
        { id: 'sec-1', componentId: 'comp-1', key: 'background', label: 'Background', draftMd: 'Original draft' },
      ],
      'select:project_qa_message': [{ maxSeq: 0 }],
      'insert:project_qa_message': [],
    });

    const result = await buildRefineRequest({
      db: mockDb,
      componentId: 'comp-1',
      userAnswer: 'Add more context about the team.',
      history: [],
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.system).toContain('specification refiner');
      expect(result.user).toContain('Original draft');
      expect(result.user).toContain('Add more context about the team.');
      expect(typeof result.projectId).toBe('string');
    }
  });
});
