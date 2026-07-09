import { describe, it, expect, vi } from 'vitest';
import { buildAutoDraftRequest } from '@/spec/auto-draft';
import { createMockDb } from '../test-utils/mock-db';

vi.mock('@/projects/project-files', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/projects/project-files')>();
  return {
    ...orig,
    readSpecFile: vi.fn().mockResolvedValue({ version: 1, updatedAt: '', bodyMd: '### Background\n\nOriginal draft' }),
  };
});

const projectId = 'proj-1';

describe('buildAutoDraftRequest', () => {
  it('returns error when no details exist', async () => {
    const mockDb = createMockDb({
      'select:project': [{ details: null }],
    });

    const result = await buildAutoDraftRequest({ db: mockDb, projectId });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBe('No details.');
    }
  });

  it('returns system + user + outline when details has unapproved components', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.text = 'Remove DB from demo';
    d.stages.spec.phases.craft.components = [
      { id: 'comp-ctx', templateId: 't-context', approvals: [] },
    ];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
      'select:team_spec_template': [
        { id: 't-context', kind: 'context', label: 'Context', orderIndex: 0, sections: [{ key: 'background', label: 'Background' }] },
      ],
    });

    const result = await buildAutoDraftRequest({ db: mockDb, projectId });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.system).toContain('specification drafter');
      expect(result.user).toContain('Remove DB from demo');
      expect(result.outline).toHaveLength(1);
      expect(result.outline[0].componentKind).toBe('context');
      expect(result.outline[0].sectionKey).toBe('background');
    }
  });
});

