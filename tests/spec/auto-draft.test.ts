import { describe, it, expect, vi } from 'vitest';
import { autoDraftAll, refineSection } from '@/spec/auto-draft';
import { createMockDb } from '../test-utils/mock-db';

const projectId = 'proj-1';

describe('autoDraftAll', () => {
  it('returns ok=false when no spec stage exists', async () => {
    const anthropic = {
      parse: vi.fn(),
      parseWithUsage: vi.fn(),
    };
    const mockDb = createMockDb({
      'select:project': [{ intentMd: 'test' }],
      'select:artifact': [],
      'select:project_stage': [],
    });

    const result = await autoDraftAll({ db: mockDb, anthropic, projectId });

    expect(result.ok).toBe(false);
    expect(result.sections).toEqual([]);
    expect(anthropic.parseWithUsage).not.toHaveBeenCalled();
  });

  it('calls parseWithUsage with fullSpecDraft and returns sections', async () => {
    const draftResponse = {
      sections: [
        { componentKind: 'context', sectionKey: 'background', draftMd: 'The demo uses PostgreSQL...', questions: [] },
        { componentKind: 'problem', sectionKey: 'problem', draftMd: 'The demo requires a DB...', questions: ['What about SQLite as an alternative?'] },
      ],
    };
    const anthropic = {
      parse: vi.fn(),
      parseWithUsage: vi.fn().mockResolvedValue({
        data: draftResponse,
        usage: { inputTokens: 500, outputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, durationMs: 5000 },
      }),
    };
    const stageId = 'stage-1';
    const comp1Id = 'comp-1';
    const comp2Id = 'comp-2';
    const mockDb = createMockDb({
      'select:project': [{ intentMd: 'Remove DB from demo' }],
      'select:artifact': [{ bodyMd: 'Exploration findings...' }],
      'select:project_stage': [{ id: stageId }],
      'select:project_component': [
        { id: comp1Id, kind: 'context', orderIndex: 0 },
        { id: comp2Id, kind: 'problem', orderIndex: 1 },
      ],
      'select:project_component_section': [
        { id: 'sec-1', componentId: comp1Id, key: 'background', label: 'Background', status: 'gathering', orderIndex: 0 },
        { id: 'sec-2', componentId: comp2Id, key: 'problem', label: 'Problem', status: 'gathering', orderIndex: 0 },
      ],
      'update:project_component_section': [],
      'update:project_component': [],
      'update:project': [],
      'insert:ops_mma_batch': [],
    });

    const result = await autoDraftAll({ db: mockDb, anthropic, projectId });

    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].questions).toEqual([]);
    expect(result.sections[1].questions).toHaveLength(1);
    expect(anthropic.parseWithUsage).toHaveBeenCalledTimes(1);
    expect(anthropic.parseWithUsage.mock.calls[0][1].call).toBe('fullSpecDraft');
  });
});

describe('refineSection', () => {
  it('sends section draft + user answer and returns revised draft + questions', async () => {
    const anthropic = {
      parse: vi.fn(),
      parseWithUsage: vi.fn().mockResolvedValue({
        data: { draftMd: 'Revised draft incorporating feedback.', questions: [] },
        usage: { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, durationMs: 2000 },
      }),
    };
    const mockDb = createMockDb({
      'select:project_component_section': [
        { id: 'sec-1', componentId: 'comp-1', key: 'background', label: 'Background', status: 'drafted', draftMd: 'Original draft', stale: false, aiSatisfied: false },
      ],
      'select:project_component': [
        { id: 'comp-1', stageId: 'stage-1', kind: 'context', status: 'drafted' },
      ],
      'select:project_stage': [{ projectId: 'proj-1' }],
      'select:project_qa_message': [{ maxSeq: 0 }],
      'insert:project_qa_message': [],
      'update:project_component_section': [],
      'update:project_component': [],
      'insert:ops_mma_batch': [],
    });

    const result = await refineSection({
      db: mockDb,
      anthropic,
      sectionId: 'sec-1',
      userAnswer: 'We also need to support SQLite for testing.',
      history: [],
    });

    expect(result.draftMd).toBe('Revised draft incorporating feedback.');
    expect(result.questions).toEqual([]);
    expect(anthropic.parseWithUsage).toHaveBeenCalledTimes(1);
    expect(anthropic.parseWithUsage.mock.calls[0][1].call).toBe('refineSection');
  });
});
