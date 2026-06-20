import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SpecStageClient } from '@/components/forge/SpecStageClient';
import type { ComponentView } from '@/spec/spec-core';

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

// Drafted component — the auto-draft flow produces components with status='drafted' and draftMd set.
const draftedComponents: ComponentView[] = [
  {
    id: 'c1',
    kind: 'context',
    label: 'Context',
    primaryRoles: ['PM'],
    status: 'drafted',
    orderIndex: 0,
    sections: [
      { id: 's1', key: 'background', label: 'Background', status: 'drafted', aiSatisfied: true, humanSatisfied: false, forced: false, draftMd: 'The demo uses PostgreSQL...', stale: false, orderIndex: 0 },
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
        defaultKinds={['context']}
        initialComponents={draftedComponents}
        initialSpec={null}
        initialAuditHistory={[]}
        initialCanFreeze={false}
        currentMember={{ id: 'me', displayName: 'admin', avatarTint: '#c4521e' }}
      />,
    );
    expect(screen.getByText(/Configure the main tier in Team Settings/)).toBeInTheDocument();
  });

  it('auto-constructs drafted sections and shows Draft ready for review', () => {
    wrap(
      <SpecStageClient
        projectId="p1"
        projectName="Proj"
        intentMd="Intent"
        phase="design"
        mainTierReady={true}
        mmaReady={true}
        defaultKinds={['context']}
        initialComponents={draftedComponents}
        initialSpec={null}
        initialAuditHistory={[]}
        initialCanFreeze={false}
        currentMember={{ id: 'me', displayName: 'admin', avatarTint: '#c4521e' }}
      />,
    );

    // Drafted sections auto-construct — shows the draft + approve bar immediately.
    expect(screen.getByText(/Draft ready for review/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to edit/ })).toBeInTheDocument();
  });

  it('constructing a section does NOT auto-approve off a stale (pre-draft) sign-off', async () => {
    const designSection: ComponentView[] = [
      {
        id: 'c1',
        kind: 'technical_design',
        label: 'Technical Design',
        primaryRoles: ['SWE'],
        status: 'drafted',
        orderIndex: 0,
        sections: [
          { id: 's1', key: 'current_state', label: 'Current state', status: 'drafted', aiSatisfied: true, humanSatisfied: false, forced: false, draftMd: 'Current state draft...', stale: false, orderIndex: 0 },
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
        defaultKinds={['technical_design']}
        initialComponents={designSection}
        initialSpec={null}
        initialAuditHistory={[]}
        initialCanFreeze={false}
        currentMember={{ id: 'me', displayName: 'admin', avatarTint: '#c4521e' }}
        craftCollab={{
          technical_design: {
            participants: [
              { member: { id: 'bo', displayName: 'Bo Chen', avatarTint: '#355a74' }, addedBy: null, approvedAt: '2026-06-13T09:40:00.000Z' },
            ],
            discussion: [],
          },
        }}
      />,
    );

    // Auto-constructed — shows the approve bar. Status is 'drafted' not 'approved'
    // even though Bo signed off before the draft existed (stale sign-off).
    expect(screen.getAllByRole('button', { name: /Approve/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Back to edit/ }).length).toBeGreaterThan(0);
  });
});
