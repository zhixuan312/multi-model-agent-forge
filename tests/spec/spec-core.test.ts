// @vitest-environment node
import {
  ensureSpecStage,
  captureIntent,
  loadOutline,
  loadAllMessages,
} from '@/spec/spec-core';
import { createMockDb, seq } from '../test-utils/mock-db';
import { buildInitialDetails } from '@/details/schema';

describe('ensureSpecStage — reads from details', () => {
  it('returns the active spec stage from details', async () => {
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
  it('writes the intent text into the brief, not merely SOME update', async () => {
    const projectId = 'proj-3';
    const ownerId = 'owner-3';
    const d = buildInitialDetails();
    const mockDb = createMockDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: projectId }],
    });

    // `captureIntent` and `saveBrief` are two doors onto the SAME field
    // (`setBriefText`) — spec capture and the exploration brain dump are one text. That
    // makes it worth pinning here too, rather than assuming the sibling test covers it.
    const intent = '  We need a faster checkout flow.  ';
    await captureIntent(mockDb, projectId, intent, ownerId);

    // `_wasCalled('project', 'update')` was the entire assertion. It is equally true of a
    // captureIntent that writes an empty string or the wrong field — see the matching note
    // in `explore-core.test.ts`. Passing a PADDED string and asserting nothing about it
    // also implied a trim that does not happen and is not wanted: the brief is stored
    // verbatim and trimmed by the consumers that need it.
    const set = mockDb._callsFor('project').find((c) => c.method === 'set');
    const written = (set!.args[0] as { details: typeof d }).details;
    expect(written.stages.exploration.phases.brief.text).toBe(intent);
  });
});

describe('captureIntent activity row', () => {
  it('records the capture_intent action in project_activity', async () => {
    const d = buildInitialDetails();
    const db = createMockDb({
      'select:project': [{ details: d, detailsVersion: 1 }],
      'update:project': [{ id: 'proj-1' }],
      'select:team_member': [{ id: 'member-1', displayName: 'Avery', avatarTint: '#09f' }],
      'insert:project_activity': [{ id: 'activity-1' }],
    });
    await captureIntent(db, 'proj-1', 'Ship it', 'member-1');
    const valuesCall = db._callsFor('project_activity').find((c) => c.method === 'values');
    expect(valuesCall?.args[0]).toMatchObject({
      label: 'Captured project intent',
      eventKey: 'capture_intent:proj-1',
      actorName: 'Avery',
    });
  });
});

describe('loadOutline', () => {
  it('returns components with template labels + their ordered sections', async () => {
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

    const outline = await loadOutline(mockDb, projectId);
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

    const result = await loadAllMessages(mockDb, 'proj-1');
    expect(result['proj-1']).toHaveLength(1);
    expect(result['proj-1'][0].bodyMd).toContain('Open Questions');
    expect(result['comp-1']).toHaveLength(1);
  });
});
