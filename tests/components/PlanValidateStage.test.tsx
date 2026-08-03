import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanStageClient, type PlanStageClientProps } from '@/components/forge/PlanStageClient';
import type { PlanPhaseView } from '@/plan/plan-core';

const { transition, showToast } = vi.hoisted(() => ({
  transition: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock('@/hooks/useMmaDispatch', () => ({
  useMmaDispatch: () => ({
    transition, dispatch: vi.fn(async () => {}),
    busyHandlers: new Set<string>(), busyRef: { current: new Set<string>() }, waitFor: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p1/plan',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/ui/toast', async (orig) => ({
  ...(await (orig() as Promise<object>)),
  showToast,
}));

const phases = (): PlanPhaseView[] =>
  [{
    id: 'ph1',
    title: 'Phase 1',
    tasks: [{ id: 't1', num: 1, title: 'Task t1', body: 'body', targetRepo: 'main', files: [], dependsOn: [], dbStatus: 'approved' }],
  }] as unknown as PlanPhaseView[];

const renderValidate = (planMd: string) =>
  render(
    <PlanStageClient
      {...({
        projectId: 'p1', projectName: 'Payments', mmaReady: true,
        phases: phases(), planMd, auditRounds: [],
        initialPhase: 'validate',
      } as unknown as PlanStageClientProps)}
    />,
  );

beforeEach(() => { transition.mockClear(); showToast.mockClear(); });

describe('Plan · Validate — locking the plan', () => {
  /**
   * This caught the rejection, reset the button and returned in silence. Every other failure
   * path in the stage toasts, and `StageAdvance`'s own inline error only covers its `href`
   * form — this advance uses `onClick`. The user pressed "Continue to Execute", nothing
   * moved, and nothing said why.
   */
  it('says so when the advance is rejected', async () => {
    transition.mockRejectedValueOnce(new Error('409'));
    renderValidate('# Plan');

    fireEvent.click(screen.getByTestId('plan-lock-button'));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());

    expect(showToast.mock.calls[0]![0]).toMatchObject({ type: 'error' });
    // And the control comes back, so the user can retry after fixing whatever blocked it.
    await vi.waitFor(() => expect(screen.getByTestId('plan-lock-button')).toBeEnabled());
  });
});

describe('Plan · Validate — the Document tab', () => {
  /**
   * With no plan file this fell through to the AUDIT branches and rendered "Ready for audit"
   * under a tab the user had selected to read the plan — an answer to a different question,
   * the same tab/content mismatch already fixed on Reflect's `?phase=summary`.
   */
  it('has its own empty state when there is no plan document', () => {
    renderValidate('');
    // With no plan the view opens on Audit, so this needs the click that reaches it — one
    // click, which is exactly how a user looking for the plan gets there.
    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }));

    expect(screen.getByText('No plan document yet')).toBeInTheDocument();
    expect(screen.queryByText('Ready for audit')).toBeNull();
  });

  it('renders the plan when there is one', () => {
    renderValidate('# The plan');
    expect(screen.queryByText('No plan document yet')).toBeNull();
  });
});

describe('Plan · Validate — which tab opens', () => {
  const withRounds = (planMd: string) =>
    render(
      <PlanStageClient
        {...({
          projectId: 'p1', projectName: 'Payments', mmaReady: true,
          phases: phases(), planMd, initialPhase: 'validate',
          auditRounds: [[{ severity: 'medium', category: 'gap', claim: 'A finding' }]],
        } as unknown as PlanStageClientProps)}
      />,
    );

  /**
   * The jump-to-newest-pass effect was keyed `rounds.length > 0`, and an effect keyed on a
   * value runs on MOUNT — so it fired immediately and overrode the initializer's
   * `planMd ? 'document'`. Someone returning to a validated plan to READ it landed on the
   * findings grid every time. Two mechanisms for one decision, the later one winning.
   */
  it('opens on the plan when there is one, even with audit history', () => {
    withRounds('# The plan');
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens on the audit when there is no plan document to show', () => {
    withRounds('');
    expect(screen.getByRole('tab', { name: 'Audit' })).toHaveAttribute('aria-selected', 'true');
  });
});
