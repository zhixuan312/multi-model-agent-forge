// @vitest-environment node
import { vi, describe, it, expect } from 'vitest';

vi.mock('@/projects/projects-core', () => ({
  getProject: vi.fn(async () => ({ name: 'Proj', details: null, detailsReady: false })),
}));
vi.mock('@/projects/project-files', () => ({
  readExplorationSummary: vi.fn(async () => null),
  readSpecFile: vi.fn(async () => null),
  readPlanFile: vi.fn(async () => null),
}));

import { buildHarvestPrompt } from '@/journal/harvest-prompt';
import { createMockDb } from '../test-utils/mock-db';

describe('buildHarvestPrompt', () => {
  it('requests structured records and never tells MMA to write journal.md', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [], 'select:project_qa_message': [] });
    const prompt = await buildHarvestPrompt('p1', db);
    expect(prompt).toContain('Return JSON with a top-level `records` array');
    expect(prompt).toContain('"heading"');
    expect(prompt).toContain('"body"');
    expect(prompt).toContain('"type"');
    expect(prompt).not.toContain('journal.md');
    expect(prompt).not.toContain('.mma/journal');
  });
});
