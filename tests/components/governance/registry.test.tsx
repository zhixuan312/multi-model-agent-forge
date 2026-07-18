import {
  GOVERNANCE_KNOBS,
  GOVERNANCE_REGISTRY,
  type GovernanceSlotId,
} from '@/components/governance/registry';

describe('component governance registry', () => {
  it('defines all governed slots for v0.4.0 and keeps GOVERNANCE_KNOBS in sync', () => {
    const ids = Object.keys(GOVERNANCE_REGISTRY) as GovernanceSlotId[];
    expect(ids).toEqual([
      // structural layers in flow order (stage flow sits between the content shell and panels)
      'background',
      'appShell',
      'contentShell',
      'stageFlow',
      'leftPanel',
      'rightPanel',
      // shared primitives
      'button',
      'badge',
      'formControl',
      'emptyState',
      'metricCard',
      'banner',
      'avatar',
      'toast',
    ]);

    const structural = ids.filter((id) => GOVERNANCE_REGISTRY[id].group === 'structural');
    const project = ids.filter((id) => GOVERNANCE_REGISTRY[id].group === 'project');
    const primitive = ids.filter((id) => GOVERNANCE_REGISTRY[id].group === 'primitive');
    expect(structural).toHaveLength(6);
    expect(project).toHaveLength(0);
    expect(primitive).toHaveLength(8);

    for (const id of ids) {
      expect(GOVERNANCE_REGISTRY[id].slotId).toBe(id);
      expect(GOVERNANCE_REGISTRY[id].canonicalComponent).toBeTruthy();
      expect(GOVERNANCE_REGISTRY[id].canonicalFilePath).toBeTruthy();
      expect(GOVERNANCE_REGISTRY[id].knobs).toEqual(GOVERNANCE_KNOBS[id]);
      expect(typeof GOVERNANCE_REGISTRY[id].renderPreview).toBe('function');
    }
  });

  it('has an empty governed-structure allowlist — every consumer is converged onto StatusDashboard', async () => {
    const list = await import('../../../eslint-rules/governed-components/allowlist.json');
    // The Content Shell rollout converged every hand-rolled stage-layout split onto
    // the canonical StatusDashboard, so there are no remaining exemptions. The
    // no-ungoverned-structure rule now guards against ANY new raw duplication.
    expect([...list.default]).toEqual([]);
  });
});
