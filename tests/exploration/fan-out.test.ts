// @vitest-environment node
import { buildProposeRequest } from '@/exploration/fan-out';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';
import { vi } from 'vitest';

vi.mock('@/projects/project-files', () => ({
  readExplorationSummary: vi.fn().mockReturnValue(null),
  readExplorationSummaryAsync: vi.fn().mockResolvedValue(null),
  readExplorationFileAsync: vi.fn().mockResolvedValue(null),
}));

describe('buildProposeRequest', () => {
  it('builds a 6-part prompt from the brief and repo list', async () => {
    const projectId = 'proj-1';
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.text = 'We want to add caching to the API.';
    d.repos = [{ id: 'repo-1', name: 'api-service', pathOnDisk: '/fake', defaultBranch: 'main' }];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
      'select:project_attachment': [],
    });

    const request = await buildProposeRequest(projectId, { db: mockDb });
    expect(request.system).toContain('Role:');
    expect(request.system).toContain('Task:');
    expect(request.system).toContain('Constraints:');
    expect(request.user).toContain('caching');
    expect(request.user).toContain('api-service');
  });

  it('includes attachment labels in the prompt', async () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.text = 'Brief text';
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
      'select:project_attachment': [{ kind: 'url', label: 'API docs', payload: 'https://api.example.com/docs' }],
    });

    const request = await buildProposeRequest('proj-1', { db: mockDb });
    expect(request.user).toContain('API docs');
  });
});
