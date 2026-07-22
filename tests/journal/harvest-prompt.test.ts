// @vitest-environment node
import { vi, describe, it, expect } from 'vitest';

vi.mock('@/projects/projects-core', () => ({
  getProject: vi.fn(async () => ({ name: 'Proj', details: null, detailsReady: false })),
}));
vi.mock('@/projects/project-files', () => ({
  readExplorationSummary: vi.fn(async () => null),
  readSpecFile: vi.fn(async () => null),
  readPlanFile: vi.fn(async () => null),
  journalFilePath: vi.fn(async () => '/abs/.mma/journal'),
}));

import { buildHarvestPrompt } from '@/journal/harvest-prompt';
import { createMockDb } from '../test-utils/mock-db';

// QA — journalFilePath is async; unawaited it interpolated as "[object Promise]" in the harvest
// prompt (the harvester was told to write learnings to a bogus path). Same class as the execute F6.
describe('buildHarvestPrompt', () => {
  it('interpolates the AWAITED journal path, never a Promise', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [], 'select:project_qa_message': [] });
    const prompt = await buildHarvestPrompt('p1', db);
    expect(prompt).toContain('/abs/.mma/journal');
    expect(prompt).not.toContain('[object Promise]');
  });
});
