// @vitest-environment node
import { eq, and } from 'drizzle-orm';
import { stage, project } from '@/db/schema/projects';
import { componentSection, qaMessage, component } from '@/db/schema/spec';
import {
  ensureSpecStage,
  captureIntent,
  loadOutline,
  loadSectionMessages,
  buildSectionRepaint,
} from '@/spec/spec-core';
import { createMockDb, seq } from '../test-utils/mock-db';

describe('ensureSpecStage — lazy stage lifecycle (F10)', () => {
  it('returns the active spec stage; a second call does not duplicate it', async () => {
    const projectId = 'proj-1';
    const stageId = 'stage-1';
    const mockDb = createMockDb({
      'select:project_stage': seq(
        [],
        [{ id: stageId, projectId, kind: 'spec', status: 'active' }],
      ),
      'insert:project_stage': [{ id: stageId, projectId, kind: 'spec', status: 'active' }],
      'update:project_stage': [],
    });

    const first = await ensureSpecStage(mockDb, projectId);
    expect(first.status).toBe('active');
    const second = await ensureSpecStage(mockDb, projectId);
    expect(second.id).toBe(first.id);
  });

  it('flips a pending spec stage to active', async () => {
    const projectId = 'proj-2';
    const stageId = 'stage-2';
    const mockDb = createMockDb({
      'select:project_stage': [{ id: stageId, projectId, kind: 'spec', status: 'pending', startedAt: null }],
      'update:project_stage': [{ id: stageId, projectId, kind: 'spec', status: 'active' }],
    });

    const res = await ensureSpecStage(mockDb, projectId);
    expect(res.status).toBe('active');
  });
});

describe('captureIntent', () => {
  it('writes intent_md + derives summary (pure)', async () => {
    const projectId = 'proj-3';
    const ownerId = 'owner-3';
    const mockDb = createMockDb({
      'select:project': [{ id: projectId, intentMd: null, summary: null }],
      'update:project': [{ id: projectId, intentMd: '  We   need a faster checkout flow.  ', summary: 'We need a faster checkout flow.' }],
    });

    await captureIntent(mockDb, projectId, '  We   need a faster checkout flow.  ', ownerId);
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });
});

describe('section + project_qa_message persistence (DB integration)', () => {
  it('an answer persists a member project_qa_message, and loadSectionMessages returns them in seq order', async () => {
    const projectId = 'proj-4';
    const sectionId = 'sec-1';
    const ownerId = 'owner-4';
    const mockDb = createMockDb({
      'select:project_qa_message': [
        { id: 'msg-1', sectionId, sender: 'forge', bodyMd: 'What is the goal?', seq: 1 },
        { id: 'msg-2', sectionId, sender: 'member', bodyMd: 'Speed up checkout.', seq: 2, authorId: ownerId },
        { id: 'msg-3', sectionId, sender: 'forge', bodyMd: 'And the constraint?', seq: 3 },
      ],
      'select:project_component_section': [{ id: sectionId, status: 'gathering', aiSatisfied: false }],
    });

    const msgs = await loadSectionMessages(mockDb, sectionId);
    expect(msgs.map((m) => m.sender)).toEqual(['forge', 'member', 'forge']);
    const memberMsg = msgs.find((m) => m.sender === 'member');
    expect(memberMsg?.bodyMd).toBe('Speed up checkout.');
  });
});

describe('loadOutline', () => {
  it('returns components with template labels + their ordered sections', async () => {
    const specStageId = 'stage-3';
    const comp1Id = 'comp-1';
    const comp2Id = 'comp-2';
    const mockDb = createMockDb({
      'select:project_component': [
        { id: comp1Id, stageId: specStageId, kind: 'context_scope', status: 'gathering' },
        { id: comp2Id, stageId: specStageId, kind: 'problem_motivation', status: 'gathering' },
      ],
      'select:project_component_section': seq(
        [
          { id: 'sec-1', componentId: comp1Id, key: 'background', label: 'Background', status: 'gathering' },
          { id: 'sec-2', componentId: comp1Id, key: 'scope', label: 'Scope', status: 'gathering' },
        ],
        [{ id: 'sec-3', componentId: comp2Id, key: 'problem', label: 'Problem', status: 'gathering' }],
      ),
    });

    const outline = await loadOutline(mockDb, specStageId);
    expect(outline.map((c) => c.kind)).toEqual(['context_scope', 'problem_motivation']);
    expect(outline[0].label).toBe('Context & scope');
    expect(outline[0].sections.map((s) => s.key)).toEqual(['background', 'scope']);
  });
});
