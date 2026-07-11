// @vitest-environment node
import {
  ensureSpecStage,
  captureIntent,
  loadOutline,
  loadComponentMessages,
  loadAllMessages,
} from '@/spec/spec-core';
import { createMockDb, seq } from '../test-utils/mock-db';

describe('ensureSpecStage — reads from details', () => {
  it('returns the active spec stage from details', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-1';
    const d = buildInitialDetails();
    d.stages.spec.status = 'active';
    // approvers = the spec-level sign-off recorded at Finalize (NOT participants).
    d.stages.spec.phases.finalize.approvals = ['m1'];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
    });

    const first = await ensureSpecStage(mockDb, projectId);
    expect(first.status).toBe('active');
    expect(first.approvers).toContain('m1');
  });

  it('flips a pending spec stage to active via details', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-2';
    const d = buildInitialDetails();
    d.stages.spec.status = 'pending';
    const mockDb = createMockDb({
      'select:project': seq([{ details: d }], [{ details: d, detailsVersion: 0 }]),
      'update:project': [{ id: projectId }],
    });

    const res = await ensureSpecStage(mockDb, projectId);
    expect(res.status).toBe('active');
  });
});

describe('captureIntent', () => {
  it('writes intent to details via setBriefText', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-3';
    const ownerId = 'owner-3';
    const d = buildInitialDetails();
    const mockDb = createMockDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: projectId }],
      'insert:ops_action_log': [],
    });

    await captureIntent(mockDb, projectId, '  We need a faster checkout flow.  ', ownerId);
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });
});

describe('section + project_qa_message persistence (DB integration)', () => {
  it('an answer persists a member project_qa_message, and loadComponentMessages returns them in seq order', async () => {
    const sectionId = 'sec-1';
    const ownerId = 'owner-4';
    const FORGE_ID = '00000000-0000-0000-0000-000000000000';
    const mockDb = createMockDb({
      'select:project_qa_message': [
        { id: 'msg-1', sectionId, bodyMd: 'What is the goal?', seq: 1, authorId: FORGE_ID },
        { id: 'msg-2', sectionId, bodyMd: 'Speed up checkout.', seq: 2, authorId: ownerId },
        { id: 'msg-3', sectionId, bodyMd: 'And the constraint?', seq: 3, authorId: FORGE_ID },
      ],
      'select:project_component_section': [{ id: sectionId, status: 'gathering', aiSatisfied: false }],
    });

    const msgs = await loadComponentMessages(mockDb, sectionId);
    expect(msgs.map((m) => m.sender)).toEqual(['forge', 'member', 'forge']);
    const memberMsg = msgs.find((m) => m.sender === 'member');
    expect(memberMsg?.bodyMd).toBe('Speed up checkout.');
  });
});

describe('loadOutline', () => {
  it('returns components with template labels + their ordered sections', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const projectId = 'proj-outline';
    const comp1Id = 'comp-1';
    const comp2Id = 'comp-2';
    const d = buildInitialDetails();
    const tplId1 = 'tpl-context-uuid';
    const tplId2 = 'tpl-problem-uuid';
    d.stages.spec.phases.craft.components = [
      { id: comp1Id, templateId: tplId1, approvals: [] },
      { id: comp2Id, templateId: tplId2, approvals: [] },
    ];
    const mockDb = createMockDb({
      'select:project': [{ details: d }],
      'select:team_spec_template': [
        { id: tplId1, kind: 'context', label: 'Context', orderIndex: 0, sections: [{ key: 'background', label: 'Background' }] },
        { id: tplId2, kind: 'problem', label: 'Problem', orderIndex: 1, sections: [{ key: 'problem', label: 'Problem' }] },
      ],
    });

    const outline = await loadOutline(mockDb, 'ignored', projectId);
    expect(outline.map((c) => c.kind)).toEqual(['context', 'problem']);
    expect(outline[0].label).toBe('Context');
    expect(outline[0].sections.map((s) => s.key)).toEqual(['background']);
  });
});

describe('loadAllMessages', () => {
  it('includes project-level spec questions under the project id key', async () => {
    const FORGE_ID = '00000000-0000-0000-0000-000000000000';
    const mockDb = createMockDb({
      'select:project_qa_message': [
        { id: 'msg-project', targetId: 'proj-1', bodyMd: '**Open Questions**\n\nNeed an owner.', authorId: FORGE_ID },
        { id: 'msg-component', targetId: 'comp-1', bodyMd: 'Looks good.', authorId: FORGE_ID },
      ],
    });

    const result = await loadAllMessages(mockDb, 'ignored', 'proj-1');
    expect(result['proj-1']).toHaveLength(1);
    expect(result['proj-1'][0].bodyMd).toContain('Open Questions');
    expect(result['comp-1']).toHaveLength(1);
  });
});
