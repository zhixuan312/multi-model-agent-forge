import { describe, it, expect, vi } from 'vitest';
import { buildAutoDraftRequest } from '@/spec/auto-draft';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/projects/project-files')>();
  return {
    ...orig,
    readSpecFileAsync: vi.fn().mockResolvedValue({ version: 1, updatedAt: '', bodyMd: '### Background\n\nOriginal draft' }),
  };
});

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

