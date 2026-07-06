// @vitest-environment node
import {
  onHumanSatisfied,
  confirmComponents,
  allComponentsApproved,
} from '@/spec/orchestrator';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb, seq, type MockResponses } from '../test-utils/mock-db';

function createOrchestratorDb(responses: MockResponses = {}) {
  return Object.assign(createMockDb(responses), { execute: async () => [] });
}

const projectId = 'stage-1';
const componentId = 'comp-1';

describe('confirmComponents', () => {
  it('creates one component + one section per template section (gathering)', async () => {
    const d = buildInitialDetails();
    const mockDb = createOrchestratorDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: projectId }],
    });
    await confirmComponents(mockDb, projectId, ['context']);
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });

  it('is additive on re-open — no duplicate components', async () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [
      { id: componentId, templateId: 'context', approvals: ['m1'] },
    ];
    const mockDb = createOrchestratorDb({
      'select:project': [{ details: d, detailsVersion: 0 }],
      'update:project': [{ id: projectId }],
    });
    await confirmComponents(mockDb, projectId, ['context', 'problem']);
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });
});

describe('allComponentsApproved', () => {
  it('returns true when all components are approved', async () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [
      { id: 'c1', templateId: 'context', approvals: ['m1'] },
      { id: 'c2', templateId: 'problem', approvals: ['m1'] },
    ];
    const mockDb = createOrchestratorDb({
      'select:project': [{ details: d }],
    });
    expect(await allComponentsApproved(mockDb, projectId)).toBe(true);
  });

  it('returns false when any component is not approved', async () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [
      { id: 'c1', templateId: 'context', approvals: ['m1'] },
      { id: 'c2', templateId: 'problem', approvals: [] },
    ];
    const mockDb = createOrchestratorDb({
      'select:project': [{ details: d }],
    });
    expect(await allComponentsApproved(mockDb, projectId)).toBe(false);
  });

  it('returns false when there are no components', async () => {
    const d = buildInitialDetails();
    const mockDb = createOrchestratorDb({
      'select:project': [{ details: d }],
    });
    expect(await allComponentsApproved(mockDb, projectId)).toBe(false);
  });
});

describe('onHumanSatisfied', () => {
  it('adds the member to the component approvals via updateDetails', async () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [
      { id: componentId, templateId: 'context', approvals: [] },
    ];
    const mockDb = createOrchestratorDb({
      'select:project': seq(
        [{ id: projectId, details: d }],
        [{ details: d, detailsVersion: 0 }],
      ),
      'update:project': [{ id: projectId }],
    });
    await onHumanSatisfied({ db: mockDb }, componentId, 'member-1');
    expect(mockDb._assertCalled('project', 'update')).toBe(true);
  });

  it('records the approver in spec.participants too (an approver is a participant)', async () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.craft.components = [{ id: componentId, templateId: 'context', approvals: [] }];
    const mockDb = createOrchestratorDb({
      'select:project': seq([{ id: projectId, details: d }], [{ details: d, detailsVersion: 0 }]),
      'update:project': [{ id: projectId }],
    });
    await onHumanSatisfied({ db: mockDb }, componentId, 'member-1');
    const written = (mockDb._callsFor('project').find((c) => c.method === 'set')!.args[0] as { details: typeof d }).details;
    expect(written.stages.spec.phases.craft.components[0].approvals).toContain('member-1');
    expect(written.stages.spec.participants).toContain('member-1'); // the gap this closes
  });
});
