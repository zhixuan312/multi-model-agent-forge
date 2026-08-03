import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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
    approvedBy: [],
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
  approvedBy: [],
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

describe('Spec · Outline — why Continue is disabled', () => {
  const renderOutline = (intentMd: string | null) =>
    wrap(
      <SpecStageClient
        {...({
          projectId: 'p1', projectName: 'Payments', intentMd, phase: 'design',
          mainTierReady: true, mmaReady: true, defaultKinds: ['context'],
          initialComponents: [], initialSpec: null, initialAuditHistory: [],
          currentMember: { id: 'm1', displayName: 'Me', avatarTint: '#000' },
          projectMembers: [], initialMessages: {}, voiceEnabled: false,
          specApprovers: [], initialPhase: 'outline',
        } as unknown as Parameters<typeof SpecStageClient>[0])}
      />,
    );

  /**
   * Both gates on Continue are invisible from this screen: the intent is carried from the
   * Exploration brief and is not editable here. `projects-core` already names the
   * missing-intent case as one that leaves the outline "permanently stuck with no UI to
   * unblock them" — it seeds intent for subset projects for exactly that reason. A disabled
   * button that does not say why is the same dead end with fewer clues.
   */
  it('names the missing exploration brief', () => {
    renderOutline(null);
    expect(screen.getByTestId('outline-continue')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/exploration brief/i);
  });

  it('says nothing when the outline is ready to confirm', () => {
    renderOutline('We are building a payments API.');
    expect(screen.getByTestId('outline-continue')).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Spec · Craft — Revoke returns you to editing', () => {
  const approvedComponent: ComponentView[] = [
    {
      id: 'c1', kind: 'context', label: 'Context', primaryRoles: ['PM'],
      status: 'approved', aiSatisfied: true, humanSatisfied: true,
      approvedBy: ['me'], participantIds: [], orderIndex: 0,
      sections: [{ id: 's1', key: 'background', label: 'Background', draftMd: 'The demo uses PostgreSQL...', orderIndex: 0 }],
    } as unknown as ComponentView,
  ];

  /**
   * `backToEdit` deleted the component's entry from `constructedDrafts` to reveal the
   * composer. That map is a CACHE DERIVED from `components`, rebuilt by an effect on every
   * `components` change — and the optimistic `onPatch` in the same function changes
   * `components` in the same tick. The deletion was undone immediately: the draft reappeared,
   * the composer stayed hidden, and Revoke did the one thing its name is not about and none
   * of what it is. It now sets the view override, which is the mechanism the Spec/Discussion
   * tabs already use.
   */
  it('shows the composer again after revoking', async () => {
    renderSpec({ initialPhase: 'craft', initialComponents: approvedComponent });

    fireEvent.click(screen.getByRole('button', { name: /Revoke/ }));

    // The composer is what "back to edit" means here — it only renders when the spec draft
    // is not the active view. Queried as an element: it carries `role="combobox"` whenever
    // its mention pool is non-empty, which in Craft it always is (Forge is in it).
    await vi.waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());
  });
});

describe('Spec · Outline — a confirmed outline is locked', () => {
  /**
   * `allowed-actions` offers `select_components` only while `outline.status === 'active'`, so
   * once the outline is confirmed the transition is rejected. The picker stayed fully
   * interactive anyway — tiles toggled, templates switched, the selection visibly changed —
   * and Continue then navigated to Craft with none of it applied. Craft's rail even offered
   * "Add component", which lands here. Editing that cannot be saved must not look like
   * editing.
   */
  it('disables the component tiles once components exist', () => {
    renderSpec({ initialPhase: 'outline', initialComponents: draftedComponents });

    for (const tile of screen.getAllByRole('button', { name: /Context/ })) {
      expect(tile).toBeDisabled();
    }
    expect(screen.getByRole('status')).toHaveTextContent(/confirmed/i);
  });

  it('leaves them editable before the outline is confirmed', () => {
    renderSpec({ initialPhase: 'outline', initialComponents: [] });
    const tiles = screen.getAllByRole('button', { name: /Context/ });
    expect(tiles.some((t) => !(t as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe('Spec · Finalize — applying a subset of findings', () => {
  const withPass = () =>
    renderSpec({
      initialPhase: 'finalize',
      initialComponents: draftedComponents,
      initialSpec: { version: 1, bodyMd: '# Spec' },
      initialAuditHistory: [{
        passNo: 1,
        verdict: 'revised',
        findingsCount: 3,
        applied: false,
        appliedIndices: [0, 1],
        findings: [
          { severity: 'high', category: 'gap', claim: 'Already fixed A' },
          { severity: 'high', category: 'gap', claim: 'Already fixed B' },
          { severity: 'medium', category: 'gap', claim: 'Still open C' },
        ],
      }] as unknown as React.ComponentProps<typeof SpecStageClient>['initialAuditHistory'],
    });

  /**
   * Select-all and Apply acted on the WHOLE set. After applying 2 of 3, "Select all"
   * re-selected the two already-fixed findings and Apply re-dispatched them — a second agent
   * pass revising sections that were already revised, billed again. Plan and Review both use
   * `appliedState` from the shared pattern; Spec never adopted it.
   */
  it('counts and selects only what remains', () => {
    withPass();
    // The pane opens on the assembled spec; the findings live behind the Audit tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }));
    fireEvent.click(screen.getByRole('button', { name: /Select all/ }));
    // One finding remains, so that is what the button offers to apply.
    expect(screen.getByRole('button', { name: 'Apply (1)' })).toBeInTheDocument();
  });

  it('dispatches only the un-applied indices', () => {
    withPass();
    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }));
    fireEvent.click(screen.getByRole('button', { name: /Select all/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));

    expect(transition).toHaveBeenCalledWith(
      'apply_findings',
      expect.objectContaining({ findingIndices: [2], passNo: 1 }),
    );
  });
});
