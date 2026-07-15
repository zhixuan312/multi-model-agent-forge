import {
  GOVERNANCE_KNOBS,
  GOVERNANCE_REGISTRY,
  type GovernanceSlotId,
} from '@/components/governance/registry';

describe('component governance registry', () => {
  it('defines all governed slots for v0.4.0 and keeps GOVERNANCE_KNOBS in sync', () => {
    const ids = Object.keys(GOVERNANCE_REGISTRY) as GovernanceSlotId[];
    expect(ids).toEqual([
      'plainBackground',
      'stageFlow',
      'sidebar',
      'stageLayout',
      'pageShell',
      'authPlainBackground',
      'pageHeader',
      'badge',
      'emptyState',
      'metricCard',
      'tabs',
    ]);

    const structural = ids.filter((id) => GOVERNANCE_REGISTRY[id].group === 'structural');
    const leaf = ids.filter((id) => GOVERNANCE_REGISTRY[id].group === 'leaf');
    expect(structural).toHaveLength(6);
    expect(leaf).toHaveLength(5);

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
