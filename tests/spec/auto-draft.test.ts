import { describe, it, expect, vi } from 'vitest';
import { autoDraftSection, autoDraftAll } from '@/spec/auto-draft';
import { createMockDb, seq } from '../test-utils/mock-db';

const mockAnthropic = (draftMd: string) => ({
  parse: vi.fn().mockResolvedValue({ draftMd }),
  parseWithUsage: vi.fn().mockResolvedValue({
    data: { draftMd },
    usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, durationMs: 500 },
  }),
});

const specStageId = 'stage-1';
const projectId = 'proj-1';
const comp1Id = 'comp-1';
const sec1Id = 'sec-1';
const sec2Id = 'sec-2';

describe('autoDraftSection', () => {
  it('drafts a section from exploration context and sets ai_satisfied + drafted status', async () => {
    const anthropic = mockAnthropic('## Background\nThis is the drafted background.');
    const mockDb = createMockDb({
      'select:project_component_section': [
        { id: sec1Id, componentId: comp1Id, key: 'background', label: 'Background', status: 'gathering', draftMd: null, stale: false, aiSatisfied: false },
      ],
      'select:project_component': [
        { id: comp1Id, stageId: specStageId, kind: 'context', status: 'gathering' },
      ],
      'select:project_stage': [{ projectId }],
      'select:project': [{ intentMd: 'Remove DB dependency from demo' }],
      'select:artifact': [{ bodyMd: '## Context\nThe demo uses PostgreSQL...' }],
      'update:project_component_section': [],
      'update:project_component': [],
      'insert:ops_mma_batch': [],
    });

    await autoDraftSection({
      db: mockDb,
      anthropic: anthropic as any,
      sectionId: sec1Id,
    });

    expect(anthropic.parseWithUsage).toHaveBeenCalledTimes(1);
    const callArgs = anthropic.parseWithUsage.mock.calls[0];
    expect(callArgs[1].call).toBe('autoDraftSection');
  });

  it('skips sections that are already drafted', async () => {
    const anthropic = mockAnthropic('should not be called');
    const mockDb = createMockDb({
      'select:project_component_section': [
        { id: sec1Id, componentId: comp1Id, key: 'background', label: 'Background', status: 'drafted', draftMd: 'existing draft', stale: false, aiSatisfied: true },
      ],
    });

    await autoDraftSection({
      db: mockDb,
      anthropic: anthropic as any,
      sectionId: sec1Id,
    });

    expect(anthropic.parseWithUsage).not.toHaveBeenCalled();
  });

  it('skips sections that are already approved', async () => {
    const anthropic = mockAnthropic('should not be called');
    const mockDb = createMockDb({
      'select:project_component_section': [
        { id: sec1Id, componentId: comp1Id, key: 'background', label: 'Background', status: 'approved', draftMd: 'approved draft', stale: false, aiSatisfied: true },
      ],
    });

    await autoDraftSection({
      db: mockDb,
      anthropic: anthropic as any,
      sectionId: sec1Id,
    });

    expect(anthropic.parseWithUsage).not.toHaveBeenCalled();
  });
});

describe('autoDraftAll', () => {
  it('returns total=0 when no spec stage exists', async () => {
    const anthropic = mockAnthropic('nope');
    const mockDb = createMockDb({
      'select:project_stage': [],
    });

    const results = await autoDraftAll({
      db: mockDb,
      anthropic: anthropic as any,
      projectId,
    });

    expect(results.total).toBe(0);
    expect(results.drafted).toBe(0);
    expect(anthropic.parseWithUsage).not.toHaveBeenCalled();
  });
});
