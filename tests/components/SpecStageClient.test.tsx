import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SpecStageClient } from '@/components/forge/SpecStageClient';
import type { ComponentView } from '@/spec/spec-core';

// SpecStageClient uses next/navigation's useRouter (Document-phase automation
// hand-off) — there's no app-router context in jsdom, so stub it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
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
        currentMember={{ id: 'me', displayName: 'admin', avatarTint: '#c4521e' }}
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
        currentMember={{ id: 'me', displayName: 'admin', avatarTint: '#c4521e' }}
      />,
    );

    // With components present and no spec, the stage lands in Craft: the
    // messenger-style composer drives the active component.
    expect(screen.getByRole('button', { name: /Construct section/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send answer/ })).toBeInTheDocument();
    // The active component's label is shown (rail + conversation header).
    expect(screen.getAllByText('Context').length).toBeGreaterThan(0);
  });

  it('constructing a section does NOT auto-approve off a stale (pre-draft) sign-off', async () => {
    // The proposed_design section is seeded with a teammate who approved an
    // EARLIER version. Constructing a fresh draft must land on review — not jump
    // straight to "approved" via the ≥1-approver gate (the reported bug).
    const designSection: ComponentView[] = [
      {
        id: 'c1',
        kind: 'proposed_design',
        label: 'Proposed design',
        primaryRoles: ['Tech Lead'],
        status: 'gathering',
        orderIndex: 0,
        sections: [
          { id: 's1', key: 'overview', label: 'Overview', status: 'gathering', aiSatisfied: false, humanSatisfied: false, forced: false, draftMd: null, stale: false, orderIndex: 0 },
        ],
      },
    ];
    wrap(
      <SpecStageClient
        projectId="p1"
        projectName="Proj"
        intentMd="Intent"
        phase="design"
        mainTierReady={true}
        mmaReady={true}
        defaultKinds={['proposed_design']}
        initialComponents={designSection}
        initialSpec={null}
        initialAuditHistory={[]}
        initialCanFreeze={false}
        currentMember={{ id: 'me', displayName: 'admin', avatarTint: '#c4521e' }}
        craftCollab={{
          proposed_design: {
            participants: [
              { member: { id: 'bo', displayName: 'Bo Chen', avatarTint: '#355a74' }, addedBy: null, approvedAt: '2026-06-13T09:40:00.000Z' },
            ],
            discussion: [],
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Construct section/ }));

    // Lands on review, NOT auto-approved off Bo's stale sign-off.
    expect(await screen.findByText(/Draft ready for review/)).toBeInTheDocument();
    expect(screen.queryByText(/Section approved/)).not.toBeInTheDocument();
  });
});
