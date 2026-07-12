import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SpecStageClient } from '@/components/forge/SpecStageClient';
import type { ComponentView } from '@/spec/spec-core';

const dispatchAutoDraft = vi.fn(async () => {});
const transition = vi.fn(async () => {});
let busyHandlers = new Set<string>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/hooks/useMmaDispatch', () => ({
  useMmaDispatch: () => ({
    busyHandlers,
    dispatch: dispatchAutoDraft,
    transition,
  }),
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

const gathering: ComponentView[] = [{
  id: 'c1',
  kind: 'context',
  label: 'Context',
  primaryRoles: [],
  status: 'gathering',
  aiSatisfied: false,
  humanSatisfied: false,
  forced: false,
  stale: false,
  approvedBy: [],
  mmaSessionId: null,
  participantIds: [],
  orderIndex: 0,
  sections: [{ id: 's1', key: 'background', label: 'Background', draftMd: null, orderIndex: 0 }],
}];

describe('SpecStageClient', () => {
  beforeEach(() => {
    dispatchAutoDraft.mockClear();
    transition.mockClear();
    busyHandlers = new Set<string>();
  });

  describe('auto-draft guard', () => {
    // Load-bearing RED case: at HEAD the effect only checks props.pendingAutoDraft, NOT
    // mma.busyHandlers, so a concurrent in-flight draft (busyHandlers set, pendingAutoDraft
    // unset) would still dispatch. The hardened guard (autoDrafting = pendingAutoDraft ||
    // busyHandlers.has('spec-auto-draft')) must suppress it. This case FAILS at HEAD.
    it('does not fire when spec-auto-draft is busy even if pendingAutoDraft is unset', () => {
      busyHandlers = new Set(['spec-auto-draft']);
      wrap(
        <SpecStageClient
          projectId="p1"
          projectName="Proj"
          intentMd="Intent"
          phase="design"
          mainTierReady
          mmaReady
          defaultKinds={['context']}
          initialComponents={gathering}
          initialSpec={null}
          initialAuditHistory={[]}
          initialCanFreeze={false}
          currentMember={{ id: 'me', displayName: 'admin', avatarTint: '#c4521e' }}
          projectMembers={[]}
          initialMessages={{}}
          voiceEnabled={false}
          specApprovers={[]}
          initialPhase="craft"
        />,
      );
      expect(dispatchAutoDraft).not.toHaveBeenCalled();
    });

    it('does not fire when pendingAutoDraft is already present', () => {
      wrap(
        <SpecStageClient
          projectId="p1"
          projectName="Proj"
          intentMd="Intent"
          phase="design"
          mainTierReady
          mmaReady
          defaultKinds={['context']}
          initialComponents={gathering}
          initialSpec={null}
          initialAuditHistory={[]}
          initialCanFreeze={false}
          currentMember={{ id: 'me', displayName: 'admin', avatarTint: '#c4521e' }}
          projectMembers={[]}
          initialMessages={{}}
          voiceEnabled={false}
          specApprovers={[]}
          pendingAutoDraft="batch-1"
          initialPhase="craft"
        />,
      );
      expect(dispatchAutoDraft).not.toHaveBeenCalled();
    });

    it('does not fire when needsAutoDraft is false because the section is already drafted', () => {
      wrap(
        <SpecStageClient
          projectId="p1"
          projectName="Proj"
          intentMd="Intent"
          phase="design"
          mainTierReady
          mmaReady
          defaultKinds={['context']}
          initialComponents={[{ ...gathering[0], status: 'drafted', aiSatisfied: true, sections: [{ ...gathering[0].sections[0], draftMd: 'ready' }] }]}
          initialSpec={null}
          initialAuditHistory={[]}
          initialCanFreeze={false}
          currentMember={{ id: 'me', displayName: 'admin', avatarTint: '#c4521e' }}
          projectMembers={[]}
          initialMessages={{}}
          voiceEnabled={false}
          specApprovers={[]}
          initialPhase="craft"
        />,
      );
      expect(dispatchAutoDraft).not.toHaveBeenCalled();
    });
  });

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

  it('does NOT render an Open Questions section — sections arrive drafted; questions come from the refine Q&A', () => {
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

    expect(screen.queryByText(/Open Questions/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Who owns rollout/)).not.toBeInTheDocument();
  });
});
