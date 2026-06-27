// @vitest-environment node
import {
  onHumanSatisfied,
  confirmComponents,
  allComponentsApproved,
} from '@/spec/orchestrator';
import { createMockDb, seq, type MockResponses } from '../test-utils/mock-db';

function createOrchestratorDb(responses: MockResponses = {}) {
  return Object.assign(createMockDb(responses), { execute: async () => [] });
}

const specStageId = 'stage-1';
const componentId = 'comp-1';
const sectionId1 = 'sec-1';

describe('confirmComponents', () => {
  it('creates one component + one section per template section (gathering)', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component': [],
      'insert:project_component': [{ id: componentId, stageId: specStageId, kind: 'context', status: 'gathering' }],
      'insert:project_component_section': [
        { id: sectionId1, componentId, key: 'background', label: 'Background', status: 'gathering', aiSatisfied: false },
      ],
      'select:project_component_section': [],
    });
    await confirmComponents(mockDb, specStageId, ['context']);
    expect(mockDb._assertCalled('project_component', 'insert')).toBe(true);
  });

  it('is additive on re-open — no duplicate components', async () => {
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

describe('allComponentsApproved', () => {
  it('returns true when all components are approved', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component': [
        { status: 'approved' },
        { status: 'approved' },
      ],
    });
    expect(await allComponentsApproved(mockDb, specStageId)).toBe(true);
  });

  it('returns false when any component is not approved', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component': [
        { status: 'approved' },
        { status: 'drafted' },
      ],
    });
    expect(await allComponentsApproved(mockDb, specStageId)).toBe(false);
  });

  it('returns false when there are no components', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component': [],
    });
    expect(await allComponentsApproved(mockDb, specStageId)).toBe(false);
  });
});

describe('onHumanSatisfied', () => {
  it('sets humanSatisfied=true and status=approved on the component', async () => {
    const mockDb = createOrchestratorDb({
      'select:project_component_section': [
        { id: sectionId1, componentId, key: 'background', label: 'Background' },
      ],
      'select:project_component': [
        { id: componentId, stageId: specStageId, kind: 'context', status: 'drafted' },
      ],
      'update:project_component': [
        { id: componentId, humanSatisfied: true, status: 'approved' },
      ],
    });
    await onHumanSatisfied({ db: mockDb }, sectionId1);
    expect(mockDb._assertCalled('project_component', 'update')).toBe(true);
  });
});
