import {
  GOVERNANCE_KNOBS,
  GOVERNANCE_REGISTRY,
  type GovernanceSlotId,
} from '@/components/governance/registry';

describe('component governance registry', () => {
  it('defines all governed slots for v0.4.0 and keeps GOVERNANCE_KNOBS in sync', () => {
    const ids = Object.keys(GOVERNANCE_REGISTRY) as GovernanceSlotId[];
    expect(ids).toEqual([
      // structural layers (bottom → top)
      'background',
      'appShell',
      'contentShell',
      'leftPanel',
      'rightPanel',
      // project-only
      'stageFlow',
      // shared primitives
      'button',
      'badge',
      'formControl',
      'emptyState',
      'metricCard',
      'banner',
      'avatar',
    ]);

    const structural = ids.filter((id) => GOVERNANCE_REGISTRY[id].group === 'structural');
    const project = ids.filter((id) => GOVERNANCE_REGISTRY[id].group === 'project');
    const primitive = ids.filter((id) => GOVERNANCE_REGISTRY[id].group === 'primitive');
    expect(structural).toHaveLength(5);
    expect(project).toHaveLength(1);
    expect(primitive).toHaveLength(7);

    for (const id of ids) {
      expect(GOVERNANCE_REGISTRY[id].slotId).toBe(id);
      expect(GOVERNANCE_REGISTRY[id].canonicalComponent).toBeTruthy();
      expect(GOVERNANCE_REGISTRY[id].canonicalFilePath).toBeTruthy();
      expect(GOVERNANCE_REGISTRY[id].knobs).toEqual(GOVERNANCE_KNOBS[id]);
      expect(typeof GOVERNANCE_REGISTRY[id].renderPreview).toBe('function');
    }
  });

  it('ships the baseline allowlist artifact seeded from every known deviation', async () => {
    const list = await import('../../../eslint-rules/governed-components/allowlist.json');
    expect([...list.default].sort()).toEqual([
      'app/(app)/projects/new/page.tsx',
      'src/components/forge/AutomationOverlay.tsx',
      'src/components/forge/ExecuteStageClient.tsx',
      'src/components/forge/JournalStageClient.tsx',
      'src/components/forge/PlanStageClient.tsx',
      'src/components/forge/ReviewStageClient.tsx',
      'src/components/forge/SpecStageClient.tsx',
      'src/components/forge/SummaryPhase.tsx',
      'src/components/patterns/status-dashboard.tsx',
    ]);
  });
});
