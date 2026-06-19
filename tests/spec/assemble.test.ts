// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { component, componentSection } from '@/db/schema/spec';
import { artifact } from '@/db/schema/artifacts';
import { actionLog } from '@/db/schema/audit';
import { assembleSpec, getLatestSpec, buildSpecMarkdown } from '@/spec/assemble';
import { createMockDb, seq } from '../test-utils/mock-db';

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

    const mockDb = createMockDb({
      'select:project': [{ name: 'Proj', visibility: 'public' }],
      'select:project_component': [{ id: componentId, kind: 'context' }],
      'select:project_component_section': [
        { id: sectionId, componentId, key: 'background', label: 'Background', status: 'approved', aiSatisfied: true, humanSatisfied: true, draftMd: 'body-background' },
      ],
      'select:project_artifact': [{ m: 0 }],
      'insert:project_artifact': [{ id: 'art-1', version: 1 }],
      'insert:ops_action_log': [{ id: 'log-1', projectId, action: 'assemble', memberId: null }],
    });

    const res = await assembleSpec(mockDb, projectId, specStageId, ownerId);
    expect(res.version).toBe(1);
    expect(res.bodyMd).toContain('## Context');
    expect(res.bodyMd).toContain('### Background');
    expect(res.bodyMd).toContain('body-background');
    expect(mockDb._assertCalled('project_artifact', 'insert')).toBe(true);
    expect(mockDb._assertCalled('ops_action_log', 'insert')).toBe(true);
  });

  it('re-assemble bumps version (prevMax+1)', async () => {
    const projectId = 'proj-2';
    const specStageId = 'stage-2';
    const ownerId = 'owner-2';

    const mockDb = createMockDb({
      'select:project': [{ name: 'Proj', visibility: 'public' }],
      'select:project_component': [{ id: 'comp-1', kind: 'context' }],
      'select:project_component_section': [
        { id: 'sec-1', componentId: 'comp-1', key: 'background', label: 'Background', status: 'approved', aiSatisfied: true, humanSatisfied: true, draftMd: 'body' },
      ],
      'select:project_artifact': seq([{ m: 0 }], [{ m: 1 }], [{ id: 'art-2', projectId, kind: 'spec', version: 2, bodyMd: 'v2' }]),
      'insert:project_artifact': seq([{ id: 'art-1', version: 1 }], [{ id: 'art-2', version: 2 }]),
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
