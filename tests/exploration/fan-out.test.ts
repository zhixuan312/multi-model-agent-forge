// @vitest-environment node
import { buildProposeRequest } from '@/exploration/fan-out';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';
import { vi } from 'vitest';

vi.mock('@/projects/project-files', () => ({
  readExplorationSummary: vi.fn().mockResolvedValue(null),
  readExplorationFile: vi.fn().mockResolvedValue(null),
}));

describe('buildProposeRequest', () => {
  it('builds a 6-part prompt from the brief and repo list', async () => {
    const projectId = 'proj-1';
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.text = 'We want to add caching to the API.';
    d.repos = [{ id: 'repo-1', name: 'api-service', pathOnDisk: '/fake', defaultBranch: 'main' }];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
    });

    const request = await buildProposeRequest(projectId, { db: mockDb });
    // All SIX parts, per the name — this asserted three, and `Output format:` is the one
    // that actually decides whether the response can be parsed at all. The sibling
    // `refine-prompt.test.ts` covers the same six for its own builder.
    for (const part of ['Role:', 'Task:', 'Context:', 'Constraints:', 'Output format:']) {
      expect(request.system, `missing prompt part: ${part}`).toContain(part);
    }
    expect(request.user).toContain('# Input:');
    expect(request.user).toContain('caching');
    expect(request.user).toContain('api-service');
  });
});
