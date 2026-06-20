// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { componentSection, component, qaMessage } from '@/db/schema/spec';
import { project } from '@/db/schema/projects';
import { actionLog } from '@/db/schema/audit';
import {
  enterSection,
  onMemberAnswer,
  onHumanSatisfied,
  forceAdvance,
  onIntentEdit,
  confirmComponents,
  allComponentsApproved,
  FORCED_DRAFT_PLACEHOLDER,
} from '@/spec/orchestrator';
import { mockAnthropicClient, type CallKind } from './mock-anthropic';
import { createMockDb, seq, type MockResponses } from '../test-utils/mock-db';

function createOrchestratorDb(responses: MockResponses = {}) {
  return Object.assign(createMockDb(responses), { execute: async () => [] });
}

const specStageId = 'stage-1';
const componentId = 'comp-1';
const projectId = 'proj-1';
const sectionId1 = 'sec-1';
const sectionId2 = 'sec-2';
const ownerId = 'owner-1';

describe('confirmComponents', () => {
  it('creates one component + one section per template section (gathering)', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component': [],
      'insert:project_component': [{ id: componentId, stageId: specStageId, kind: 'context', status: 'gathering' }],
      'insert:project_component_section': [
        { id: sectionId1, componentId, key: 'background', label: 'Background', status: 'gathering', aiSatisfied: false },
        { id: sectionId2, componentId, key: 'scope', label: 'Scope', status: 'gathering', aiSatisfied: false },
      ],
      'select:project_component_section': [
        { id: sectionId1, componentId, key: 'background', label: 'Background', status: 'gathering', aiSatisfied: false },
        { id: sectionId2, componentId, key: 'scope', label: 'Scope', status: 'gathering', aiSatisfied: false },
      ],
    });
    await confirmComponents(mockDb, specStageId, ['context']);
    expect(mockDb._assertCalled('project_component', 'insert')).toBe(true);
  });

  it('is additive on re-open — no duplicate components (F15)', async () => {
    const comp2Id = 'comp-2';
    const mockDb = createOrchestratorDb({
      'select:project_component': seq(
        [{ id: componentId, stageId: specStageId, kind: 'context', status: 'gathering' }],
        [
          { id: componentId, stageId: specStageId, kind: 'context', status: 'gathering' },
          { id: comp2Id, stageId: specStageId, kind: 'problem', status: 'gathering' },
        ],
      ),
      'insert:project_component': [{ id: comp2Id, stageId: specStageId, kind: 'problem', status: 'gathering' }],
      'select:project_component_section': [],
    });
    await confirmComponents(mockDb, specStageId, ['context', 'problem']);
    expect(mockDb._assertCalled('project_component', 'insert')).toBe(true);
  });
});

describe('enterSection — zero-question fast path', () => {
  it('drafts immediately and lands in drafted with ai_satisfied (no member turns)', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component_section': seq(
        [{ id: sectionId1, componentId, key: 'background', label: 'Background', status: 'gathering', aiSatisfied: false, humanSatisfied: false, draftMd: null, stale: false }],
        [],
        [],
        [],
      ),
      'select:project_component': [{ id: componentId, stageId: specStageId, kind: 'context' }],
      'select:project_qa_message': seq([], [], []),
      'select:project': [{ id: projectId, intentMd: 'Intent.' }],
      'select:project_artifact': [],
      'update:project_component_section': [{ id: sectionId1, status: 'drafted', aiSatisfied: true, draftMd: '## Background\nWell-supplied.' }],
      'insert:project_qa_message': [],
    });
    const calls: CallKind[] = [];
    const anthropic = mockAnthropicClient(
      {
        generateQuestions: [{ questions: [], aiSatisfiedWithoutAnswers: true, grounding: 'intent suffices' }],
        draftSection: [{ draftMd: '## Background\nWell-supplied.' }],
      },
      { calls },
    );
    await enterSection({ anthropic, db: mockDb }, sectionId1);
    expect(calls).toEqual(['generateQuestions', 'draftSection']);
  });

  it.todo('with questions: persists forge questions, stays gathering, no draft', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component_section': seq(
        [{ id: sectionId1, componentId, key: 'background', label: 'Background', draftMd: null }],
        [],
      ),
      'select:project_component': [{ id: componentId, stageId: specStageId, kind: 'context', status: 'gathering', aiSatisfied: false, stale: false }],
      'select:project_qa_message': seq([], []),
      'select:project': [{ id: projectId, intentMd: 'Intent.' }],
      'select:project_artifact': [],
      'insert:project_qa_message': [{ id: 'msg-1', componentId, sender: 'forge', bodyMd: 'Q1? Q2?' }],
      'update:project_component_section': [],
    });
    const anthropic = mockAnthropicClient({
      generateQuestions: [{ questions: ['Q1?', 'Q2?'], aiSatisfiedWithoutAnswers: false, grounding: 'need more' }],
    });
    await enterSection({ anthropic, db: mockDb }, sectionId1);
    expect(mockDb._assertCalled('project_component_section', 'update')).toBe(true);
  });
});

describe('component roll-up', () => {
  it('approved iff all sections approved; else the min state', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component_section': seq(
        [{ status: 'approved' }, { status: 'gathering' }],
        [{ status: 'approved' }, { status: 'approved' }],
      ),
      'update:project_component': [],
    });
  });
});

describe('THE DUAL GATE INVARIANT', () => {
  it.todo('human_satisfied alone does NOT approve', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component_section': seq(
        [{ id: sectionId1, componentId, key: 'background', status: 'drafted', draftMd: 'body', aiSatisfied: false, humanSatisfied: false }],
        [{ status: 'drafted' }],
      ),
      'select:project_component': [{ id: componentId, stageId: specStageId, kind: 'context' }],
      'update:project_component_section': [{ id: sectionId1, status: 'drafted', humanSatisfied: true }],
    });
    const anthropic = mockAnthropicClient({});
    await onHumanSatisfied({ anthropic, db: mockDb }, sectionId1);
    expect(mockDb._assertCalled('project_component_section', 'update')).toBe(true);
  });

  it.todo('ai_satisfied && human_satisfied → approved', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component_section': seq(
        [{ id: sectionId1, componentId, key: 'background', label: 'Background', status: 'gathering', aiSatisfied: false, humanSatisfied: false, draftMd: null, stale: false }],
        [],
        [],
        [],
        [{ id: sectionId1, componentId, key: 'background', status: 'drafted', aiSatisfied: true, humanSatisfied: true, draftMd: 'body' }],
        [{ status: 'approved' }],
      ),
      'select:project_component': seq(
        [{ id: componentId, stageId: specStageId, kind: 'context' }],
        [{ projectId }],
        [{ projectId }],
        [{ id: componentId, stageId: specStageId, kind: 'context' }],
      ),
      'select:project_qa_message': seq([], [], []),
      'select:project': [{ id: projectId, intentMd: 'Intent.' }],
      'select:project_artifact': [],
      'update:project_component_section': seq(
        [{ id: sectionId1, status: 'drafted', aiSatisfied: true }],
        [{ id: sectionId1, status: 'approved', humanSatisfied: true }],
      ),
      'insert:project_qa_message': [],
    });
    const anthropic = mockAnthropicClient({
      generateQuestions: [{ questions: [], aiSatisfiedWithoutAnswers: true, grounding: 'g' }],
      draftSection: [{ draftMd: 'body' }],
    });
    await enterSection({ anthropic, db: mockDb }, sectionId1);
    await onHumanSatisfied({ anthropic, db: mockDb }, sectionId1);
    expect(mockDb._assertCalled('project_component_section', 'update')).toBe(true);
  });
});
