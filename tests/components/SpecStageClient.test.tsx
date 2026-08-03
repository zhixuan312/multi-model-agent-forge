import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SpecStageClient } from '@/components/forge/SpecStageClient';
import type { ComponentView } from '@/spec/spec-core';

const dispatchAutoDraft = vi.fn(async () => {});
const transition = vi.fn(async () => {});
let busyHandlers = new Set<string>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p1/spec',
  useSearchParams: () => new URLSearchParams(),
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

/**
 * The same ~18 props were repeated verbatim in all seven cases below — about half the
 * file — so adding a required prop meant editing seven places, and the ONE prop each
 * case actually varies was buried in the noise. Defaults here, per-case overrides at the
 * call site, so each test states only what it is about.
 */
const BASE_PROPS = {
  projectId: 'p1',
  projectName: 'Proj',
  intentMd: 'Intent',
  phase: 'design',
  mainTierReady: true,
  mmaReady: true,
  defaultKinds: ['context'],
  initialComponents: gathering,
  initialSpec: null,
  initialAuditHistory: [],
  currentMember: { id: 'me', displayName: 'admin', avatarTint: '#c4521e' },
  projectMembers: [],
  initialMessages: {},
  voiceEnabled: false,
  specApprovers: [],
} as unknown as React.ComponentProps<typeof SpecStageClient>;

const renderSpec = (overrides: Partial<React.ComponentProps<typeof SpecStageClient>> = {}) =>
  wrap(<SpecStageClient {...BASE_PROPS} {...overrides} />);

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
      renderSpec({ initialPhase: 'craft' });
      expect(dispatchAutoDraft).not.toHaveBeenCalled();
    });

    it('does not fire when pendingAutoDraft is already present', () => {
      renderSpec({ pendingAutoDraft: 'batch-1', initialPhase: 'craft' });
      expect(dispatchAutoDraft).not.toHaveBeenCalled();
    });

    it('does not fire when needsAutoDraft is false because the section is already drafted', () => {
      renderSpec({
        initialComponents: [
          { ...gathering[0], status: 'drafted', aiSatisfied: true, sections: [{ ...gathering[0].sections[0], draftMd: 'ready' }] },
        ],
        initialPhase: 'craft',
      });
      expect(dispatchAutoDraft).not.toHaveBeenCalled();
    });
  });

  it('shows the Team-Settings entry guard when the main tier is not configured', () => {
    renderSpec({ mainTierReady: false, mmaReady: false, initialComponents: draftedComponents });
    expect(screen.getByText(/Configure the main tier in Team Settings/)).toBeInTheDocument();
  });

  it('auto-constructs drafted components and shows draft ready for review', () => {
    renderSpec({ initialComponents: draftedComponents });
    expect(screen.getByText('Spec')).toBeInTheDocument();
    expect(screen.getByText('Discussion')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
  });

  it('does NOT render an Open Questions section — sections arrive drafted; questions come from the refine Q&A', () => {
    renderSpec({
      projectId: 'proj-1',
      initialComponents: draftedComponents,
      initialMessages: {
        'proj-1': [{ id: 'msg-project', sender: 'forge', bodyMd: '**Open Questions**\n\nWho owns rollout?', authorId: null }],
      },
    });

    expect(screen.queryByText(/Open Questions/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Who owns rollout/)).not.toBeInTheDocument();
  });

  describe('audit-running indicator survives navigation (F1)', () => {
    it('shows "Auditing…" on the Finalize audit button when spec-audit is in flight after a remount', () => {
      // The remount scenario: local `auditing` is false (fresh mount), but the spec-audit batch
      // is still running server-side, so mma.busyHandlers rehydrated it via /pending-handlers.
      // The running indicator MUST come from busyHandlers, not only the ephemeral local flag.
      busyHandlers = new Set(['spec-audit']);
      renderSpec({
        initialComponents: draftedComponents,
        initialSpec: { version: 1, bodyMd: '# Spec\n\n## Context\n\nBackground prose.' },
        initialPhase: 'finalize',
      });
      expect(screen.getByText('Auditing…')).toBeInTheDocument();
    });
  });

  /**
   * Exactly one template is active at a time, so the picker is a radiogroup. It used to
   * render each row with `aria-pressed`, which announces an independent on/off button and
   * never conveys "1 of N" — the same single-choice model `Segmented` and `AvatarPicker`
   * already get right.
   */
  describe('template picker is single-select', () => {
    it('exposes a named radiogroup of radios, not toggle buttons', () => {
      renderSpec({ initialPhase: 'outline' });
      const group = screen.getByRole('radiogroup', { name: 'Spec template' });
      expect(group).toBeInTheDocument();
      expect(within(group).getAllByRole('radio').length).toBeGreaterThan(0);
      // Scoped to the group: the multi-select component tiles elsewhere on this phase use
      // `aria-pressed` correctly, so a page-wide assertion would fail on a non-defect.
      expect(within(group).queryAllByRole('button')).toHaveLength(0);
    });

    it('marks at most one option checked', () => {
      renderSpec({ initialPhase: 'outline' });
      const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
      expect(checked.length).toBeLessThanOrEqual(1);
    });

    it('keeps the passive Custom indicator out of the group — it has no onClick, so it is not a choice', () => {
      renderSpec({ initialPhase: 'outline' });
      expect(screen.getByRole('radiogroup', { name: 'Spec template' })).not.toHaveTextContent('Custom');
    });
  });
});
