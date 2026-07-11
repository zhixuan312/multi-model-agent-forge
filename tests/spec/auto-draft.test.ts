import { describe, it, expect, vi } from 'vitest';
import { buildSpecAuthoringRequest } from '@/spec/auto-draft';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/projects/project-files')>();
  return {
    ...orig,
    readExplorationSummary: vi.fn().mockResolvedValue('# Exploration\n\nThe search found three risks.'),
  };
});

const projectId = 'proj-1';

describe('buildSpecAuthoringRequest', () => {
  it('fails when project intent is blank', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [{ id: 'comp-ctx', templateId: 't-context', approvals: [] }];
    const mockDb = createMockDb({
      'select:project': [{ details: d, intentMd: '   ' }],
      'select:team_spec_template': [{ id: 't-context', kind: 'context', label: 'Context', orderIndex: 0, sections: [{ key: 'background', label: 'Background' }] }],
    });

    const result = await buildSpecAuthoringRequest({ db: mockDb, projectId, outputPath: '/tmp/spec.md' });
    expect(result).toEqual({ error: 'Spec drafting requires captured intent.' });
  });

  it('builds inline input with intent, exploration, selected component labels, and output path', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [{ id: 'comp-ctx', templateId: 't-context', approvals: [] }];
    const mockDb = createMockDb({
      'select:project': [{ details: d, intentMd: '# Intent\n\nShip the first draft.' }],
      'select:team_spec_template': [{ id: 't-context', kind: 'context', label: 'Context', orderIndex: 0, sections: [{ key: 'background', label: 'Background' }] }],
    });

    const result = await buildSpecAuthoringRequest({ db: mockDb, projectId, outputPath: '/tmp/spec.md' });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.target.inline).toContain('# Captured intent');
      expect(result.target.inline).toContain('# Exploration summary');
      expect(result.target.inline).toContain('- Context');
      expect(result.outputPath).toBe('/tmp/spec.md');
    }
  });
});
