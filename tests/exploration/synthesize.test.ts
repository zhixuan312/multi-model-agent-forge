// @vitest-environment node
import { buildSynthesizeRequest, gapMarker } from '@/exploration/synthesize';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';
import { vi } from 'vitest';

vi.mock('@/projects/project-files', () => ({
  readExplorationSummary: vi.fn().mockReturnValue(null),
  readExplorationSummaryAsync: vi.fn().mockResolvedValue(null),
  readExplorationFileAsync: vi.fn().mockResolvedValue(null),
  writeExplorationSummaryAsync: vi.fn().mockResolvedValue('/fake/exploration.md'),
}));

function makeDetails(tasks: Array<{ kind: string; prompt: string; status: string; repoId?: string; batchId: string }>) {
  const d = buildInitialDetails();
  d.stages.exploration.phases.discover.tasks = tasks.map((t) => ({
    kind: t.kind as 'investigate' | 'research' | 'journal',
    prompt: t.prompt,
    status: t.status as 'recorded' | 'draft',
    ...(t.repoId ? { repoId: t.repoId } : {}),
    attempts: [{ batchId: t.batchId, status: 'done' as const, at: '2026-07-01T00:00:00Z' }],
  }));
  return d;
}

describe('buildSynthesizeRequest', () => {
  it('returns error when no recorded tasks exist', async () => {
    const d = buildInitialDetails();
    const db = createMockDb({
      'select:project': [{ details: d, detailsReady: true }],
    });
    const result = await buildSynthesizeRequest('proj-1', { db });
    expect('error' in result).toBe(true);
  });

  it('builds a prompt from recorded task results', async () => {
    const d = makeDetails([{
      kind: 'investigate', prompt: 'What caching approach?', status: 'recorded',
      repoId: 'r1', batchId: 'b1',
    }]);
    const db = createMockDb({
      'select:project': [{ details: d, detailsReady: true }],
      'select:ops_mma_batch': [{ id: 'b1', route: 'investigate', status: 'done', result: { output: { summary: { answer: 'Redis with a 5-min TTL.' } } } }],
      'select:workspace_repo': [{ id: 'r1', name: 'api-service' }],
    });
    const result = await buildSynthesizeRequest('proj-1', { db });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.system).toContain('Role:');
      expect(result.user).toContain('Redis');
    }
  });

  it('includes failure markers for failed tasks', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.discover.tasks = [
      { kind: 'investigate', prompt: 'q1', status: 'recorded', repoId: 'r1', attempts: [{ batchId: 'b1', status: 'done', at: '' }] },
      { kind: 'research', prompt: 'q2', status: 'recorded', attempts: [{ batchId: 'b2', status: 'failed', at: '' }] },
    ];
    const db = createMockDb({
      'select:project': [{ details: d, detailsReady: true }],
      'select:ops_mma_batch': [
        { id: 'b1', route: 'investigate', status: 'done', result: { output: { summary: { answer: 'found stuff' } } } },
        { id: 'b2', route: 'research', status: 'failed', result: null },
      ],
      'select:workspace_repo': [{ id: 'r1', name: 'api-service' }],
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
  });

  it('formats journal_recall as journal-recall', () => {
    expect(gapMarker('journal_recall', null)).toContain('journal-recall');
  });
});
