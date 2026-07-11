import { describe, it, expect, vi } from 'vitest';
import { buildSpecAuthoringRequest } from '@/spec/auto-draft';
import { readExplorationSummary } from '@/projects/project-files';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/projects/project-files')>();
  return {
    ...orig,
    readExplorationSummary: vi.fn().mockResolvedValue('# Exploration\n\nThe search found three risks.'),
  };
});

const projectId = 'proj-1';

function mockDbWith(intentMd: string) {
  return import('@/details/schema').then(({ buildInitialDetails }) => {
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [{ id: 'comp-ctx', templateId: 't-context', approvals: [] }];
    return createMockDb({
      'select:project': [{ name: 'My Project', details: d, intentMd }],
      'select:team_spec_template': [{ id: 't-context', kind: 'context', label: 'Context', orderIndex: 0, sections: [{ key: 'background', label: 'Background' }] }],
    });
  });
}

describe('buildSpecAuthoringRequest', () => {
  it('fails when project intent is blank', async () => {
    const mockDb = await mockDbWith('   ');
    const result = await buildSpecAuthoringRequest({ db: mockDb, projectId, outputPath: 'spec.md', explorationPath: 'exploration.md' });
    expect(result).toEqual({ error: 'Spec drafting requires captured intent.' });
  });

  it('passes exploration.md by path, with intent + title in the prompt and the component subset', async () => {
    const mockDb = await mockDbWith('# Intent\n\nShip the first draft.');
    const result = await buildSpecAuthoringRequest({
      db: mockDb, projectId, outputPath: 'spec.md', explorationPath: '.mma/projects/p1/exploration.md',
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      // Exploration is the grounding artifact → delivered by path (symmetric to plan).
      expect(result.target).toEqual({ paths: ['.mma/projects/p1/exploration.md'] });
      // Intent (never a file) + the feature title ride in the prompt.
      expect(result.prompt).toContain('# Captured intent');
      expect(result.prompt).toContain('Ship the first draft.');
      // The subset is the structured `components` field.
      expect(result.components).toContain('Context');
      expect(result.outputPath).toBe('spec.md');
    }
  });

  it('falls back to an inline note when no exploration file exists', async () => {
    vi.mocked(readExplorationSummary).mockResolvedValueOnce(null);
    const mockDb = await mockDbWith('# Intent\n\nShip it.');
    const result = await buildSpecAuthoringRequest({ db: mockDb, projectId, outputPath: 'spec.md', explorationPath: 'exploration.md' });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect('inline' in result.target).toBe(true);
      if ('inline' in result.target) expect(result.target.inline).toContain('No exploration summary');
      // Intent is still delivered in the prompt.
      expect(result.prompt).toContain('# Captured intent');
    }
  });
});
