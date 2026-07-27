import { render, screen } from '@testing-library/react';
import {
  GOVERNANCE_REGISTRY,
  GOVERNANCE_SLOT_NAV,
  getComponentGovernanceView,
} from '@/components/governance/registry';

describe('sectionNavigator governance registration', () => {
  it('declares the canonical structural slot and its one route consumer', () => {
    const entry = GOVERNANCE_REGISTRY.sectionNavigator;
    expect(entry).toMatchObject({
      slotId: 'sectionNavigator',
      label: 'Section navigator',
      group: 'structural',
      canonicalComponent: 'SectionNavigator',
      canonicalFilePath: 'src/components/patterns/section-navigator.tsx',
      consumers: [{
        id: 'direction-page',
        label: 'Direction manifesto / user manual',
        filePath: 'app/(app)/direction/page.tsx',
      }],
      deviations: [],
    });
    render(<>{entry.renderPreview()}</>);
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
  });

  it('is exposed by both registry-derived catalog projections', () => {
    expect(GOVERNANCE_SLOT_NAV.map((slot) => slot.slotId).slice(0, 2)).toEqual(['background', 'sectionNavigator']);
    expect(getComponentGovernanceView().slots.find((slot) => slot.slotId === 'sectionNavigator')).toMatchObject({
      canonicalComponent: 'SectionNavigator',
      canonicalFilePath: 'src/components/patterns/section-navigator.tsx',
    });
  });
});
