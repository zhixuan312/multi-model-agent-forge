// @vitest-environment node
import { vi } from 'vitest';
import { component, componentSection } from '@/db/schema/spec';
import { actionLog } from '@/db/schema/audit';
import { assembleSpec, getLatestSpec, buildSpecMarkdown } from '@/spec/assemble';
import { createMockDb, seq } from '../test-utils/mock-db';

/* Mock file-based spec storage — assembleSpec now writes to file, not DB. */
const writeSpecAsyncMock = vi.fn();
const readSpecFileAsyncMock = vi.fn();

vi.mock('@/projects/project-files', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/projects/project-files')>();
  return {
    ...orig,
    writeSpecAsync: (...args: unknown[]) => writeSpecAsyncMock(...args),
    readSpecFileAsync: (...args: unknown[]) => readSpecFileAsyncMock(...args),
  };
});

beforeEach(() => {
  writeSpecAsyncMock.mockReset();
  readSpecFileAsyncMock.mockReset();
});

describe('buildSpecMarkdown (pure)', () => {
  it('emits ## label / ### draftHeading and preserves a ```mermaid fence verbatim', () => {
    const fence = '```mermaid\ngraph TD; A-->B;\n```';
    const md = buildSpecMarkdown(
      { name: 'Proj', visibility: 'public', version: 1 },
      [
        {
          kind: 'technical_design',
          label: 'Proposed design',
          sections: [{ key: 'system_context', label: 'System-context diagram', draftMd: fence }],
        },
      ],
    );
    expect(md).toContain('## Proposed design');
    expect(md).toContain('### System-context diagram');
    expect(md).toContain(fence);
  });
});

describe('assembleSpec', () => {
  it('produces one versioned spec artifact from approved sections + an assemble ops_action_log row', async () => {
    const projectId = 'proj-1';
    const specStageId = 'stage-1';
    const componentId = 'comp-1';
    const sectionId = 'sec-1';
    const ownerId = 'owner-1';

    // No previous spec file on disk
    readSpecFileAsyncMock.mockResolvedValue(null);
    // writeSpecAsync returns the saved version
    writeSpecAsyncMock.mockResolvedValue({ filePath: '/fake/spec.md', version: 1 });

    const mockDb = createMockDb({
      'select:project': [{ name: 'Proj', visibility: 'public' }],
      'select:project_component': [{ id: componentId, kind: 'context' }],
      'select:project_component_section': [
        { id: sectionId, componentId, key: 'background', label: 'Background', status: 'approved', aiSatisfied: true, humanSatisfied: true, draftMd: 'body-background' },
      ],
      'insert:ops_action_log': [{ id: 'log-1', projectId, action: 'assemble', memberId: null }],
    });

    const res = await assembleSpec(mockDb, projectId, specStageId, ownerId);
    expect(res.version).toBe(1);
    expect(res.bodyMd).toContain('## Context');
    expect(res.bodyMd).toContain('### Background');
    expect(res.bodyMd).toContain('body-background');
    // Spec is now written to file, not inserted into DB
    expect(writeSpecAsyncMock).toHaveBeenCalledWith(projectId, expect.any(String));
    expect(mockDb._assertCalled('ops_action_log', 'insert')).toBe(true);
  });

  it('re-assemble bumps version (prevMax+1)', async () => {
    const projectId = 'proj-2';
    const specStageId = 'stage-2';
    const ownerId = 'owner-2';

    // First assembleSpec call: no previous file
    // Second assembleSpec call: file exists with version 1
    // Third call (getLatestSpec): file exists with version 2
    readSpecFileAsyncMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: 1, updatedAt: '', bodyMd: 'v1' })
      .mockResolvedValueOnce({ version: 2, updatedAt: '', bodyMd: 'v2' });
    writeSpecAsyncMock
      .mockResolvedValueOnce({ filePath: '/fake/spec.md', version: 1 })
      .mockResolvedValueOnce({ filePath: '/fake/spec.md', version: 2 });

    const mockDb = createMockDb({
      'select:project': [{ name: 'Proj', visibility: 'public' }],
      'select:project_component': [{ id: 'comp-1', kind: 'context' }],
      'select:project_component_section': [
        { id: 'sec-1', componentId: 'comp-1', key: 'background', label: 'Background', status: 'approved', aiSatisfied: true, humanSatisfied: true, draftMd: 'body' },
      ],
      'insert:ops_action_log': [{ id: 'log-1', projectId, action: 'assemble' }, { id: 'log-2', projectId, action: 'assemble' }],
    });

    const first = await assembleSpec(mockDb, projectId, specStageId, ownerId);
    const second = await assembleSpec(mockDb, projectId, specStageId, ownerId);
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    const latest = await getLatestSpec(mockDb, projectId);
    expect(latest?.version).toBe(2);
  });
});
