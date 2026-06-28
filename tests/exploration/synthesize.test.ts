// @vitest-environment node
import { buildSynthesizeRequest, gapMarker } from '@/exploration/synthesize';
import { createMockDb } from '../test-utils/mock-db';
import { vi } from 'vitest';

vi.mock('@/projects/project-files', () => ({
  readExplorationSummary: vi.fn().mockReturnValue(null),
  readExplorationSummaryAsync: vi.fn().mockResolvedValue(null),
  readExplorationFileAsync: vi.fn().mockResolvedValue(null),
  writeExplorationSummaryAsync: vi.fn().mockResolvedValue('/fake/exploration.md'),
}));

function taskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    taskId: 'task-1',
    kind: 'investigate',
    prompt: 'What caching approach does the API use?',
    route: 'investigate',
    batchStatus: 'done',
    result: { output: { summary: { answer: 'Redis with a 5-min TTL.' } } },
    repoName: 'api-service',
    ...overrides,
  };
}

describe('buildSynthesizeRequest', () => {
  it('returns error when no recorded tasks exist', async () => {
    const db = createMockDb({
      'select:project_exploration_task': [],
    });
    const result = await buildSynthesizeRequest('proj-1', { db });
    expect('error' in result).toBe(true);
  });

  it('builds a 6-part prompt from recorded task results', async () => {
    const db = createMockDb({
      'select:project_exploration_task': [taskRow()],
    });
    const result = await buildSynthesizeRequest('proj-1', { db });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.system).toContain('Role:');
      expect(result.system).toContain('Task:');
      expect(result.system).toContain('Constraints:');
      expect(result.user).toContain('Redis');
      expect(result.user).toContain('api-service');
    }
  });

  it('includes failure markers for failed tasks', async () => {
    const db = createMockDb({
      'select:project_exploration_task': [
        taskRow(),
        taskRow({ taskId: 'task-2', batchStatus: 'failed', route: 'research', repoName: null }),
      ],
    });
    const result = await buildSynthesizeRequest('proj-1', { db });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.user).toContain('failed');
    }
  });
});

describe('gapMarker', () => {
  it('formats investigate gap with repo name', () => {
    expect(gapMarker('investigate', 'api-service')).toContain('investigate');
    expect(gapMarker('investigate', 'api-service')).toContain('api-service');
  });

  it('formats research gap without repo', () => {
    expect(gapMarker('research', null)).toContain('research');
    expect(gapMarker('research', null)).not.toContain('repo');
  });

  it('formats journal_recall as journal-recall', () => {
    expect(gapMarker('journal_recall', null)).toContain('journal-recall');
  });
});
