import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SpecStageClient } from '@/components/forge/SpecStageClient';
import type { ComponentView } from '@/spec/spec-core';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const twoSections: ComponentView[] = [
  {
    id: 'c1',
    kind: 'context_scope',
    label: 'Context',
    primaryRoles: ['PM'],
    status: 'gathering',
    orderIndex: 0,
    sections: [
      { id: 's1', key: 'background', label: 'Background', status: 'gathering', aiSatisfied: false, humanSatisfied: false, forced: false, draftMd: null, stale: false, orderIndex: 0 },
      { id: 's2', key: 'current_state', label: 'Current state', status: 'gathering', aiSatisfied: false, humanSatisfied: false, forced: false, draftMd: null, stale: false, orderIndex: 1 },
    ],
  },
];

describe('SpecStageClient', () => {
  it('shows the Team-Settings entry guard when the main tier is not configured (F27)', () => {
    wrap(
      <SpecStageClient
        projectId="p1"
        projectName="Proj"
        intentMd="Intent"
        phase="design"
        mainTierReady={false}
        mmaReady={false}
        defaultKinds={['context_scope']}
        initialComponents={twoSections}
        initialSpec={null}
        initialAuditHistory={[]}
        initialCanFreeze={false}
      />,
    );
    expect(screen.getByText(/Configure the main tier in Team Settings/)).toBeInTheDocument();
  });

  it('opens the Craft conversation for the active component (chat + composer)', () => {
    wrap(
      <SpecStageClient
        projectId="p1"
        projectName="Proj"
        intentMd="Intent"
        phase="design"
        mainTierReady={true}
        mmaReady={true}
        defaultKinds={['context_scope']}
        initialComponents={twoSections}
        initialSpec={null}
        initialAuditHistory={[]}
        initialCanFreeze={false}
      />,
    );

    // With components present and no spec, the stage lands in Craft: the
    // messenger-style composer drives the active component.
    expect(screen.getByRole('button', { name: /Construct section/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send answer/ })).toBeInTheDocument();
    // The active component's label is shown (rail + conversation header).
    expect(screen.getAllByText('Context').length).toBeGreaterThan(0);
  });
});
