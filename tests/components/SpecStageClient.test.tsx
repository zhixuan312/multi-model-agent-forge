import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SpecStageClient } from '@/components/forge/SpecStageClient';
import type { ComponentView } from '@/spec/spec-core';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

const draftedComponents: ComponentView[] = [
  {
    id: 'c1',
    kind: 'context',
    label: 'Context',
    primaryRoles: ['PM'],
    status: 'drafted',
    aiSatisfied: true,
    humanSatisfied: false,
    forced: false,
    stale: false,
    approvedBy: [],
    mmaSessionId: null,
    participantIds: [],
    orderIndex: 0,
    sections: [
      { id: 's1', key: 'background', label: 'Background', draftMd: 'The demo uses PostgreSQL...', orderIndex: 0 },
    ],
  },
];

describe('SpecStageClient', () => {
  it('shows the Team-Settings entry guard when the main tier is not configured', () => {
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
        projectMembers={[]}
        initialMessages={{}}
        voiceEnabled={false}
        specApprovers={[]}
      />,
    );
    expect(screen.getByText(/Configure the main tier in Team Settings/)).toBeInTheDocument();
  });

  it('auto-constructs drafted components and shows draft ready for review', () => {
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
        projectMembers={[]}
        initialMessages={{}}
        voiceEnabled={false}
        specApprovers={[]}
      />,
    );
    expect(screen.getByText('Spec')).toBeInTheDocument();
    expect(screen.getByText('Discussion')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
  });

  it('renders project-level open questions when the initial draft stored spec_project notes', () => {
    wrap(
      <SpecStageClient
        projectId="proj-1"
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
        projectMembers={[]}
        initialMessages={{
          'proj-1': [{ id: 'msg-project', sender: 'forge', bodyMd: '**Open Questions**\n\nWho owns rollout?', authorId: null }],
        }}
        voiceEnabled={false}
        specApprovers={[]}
      />,
    );

    const allMatches = screen.queryAllByText(/Open Questions/);
    expect(allMatches.length).toBeGreaterThan(0);
    expect(screen.getByText(/Who owns rollout/)).toBeInTheDocument();
  });
});
