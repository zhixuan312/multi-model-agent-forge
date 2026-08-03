import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanStageClient, type PlanStageClientProps } from '@/components/forge/PlanStageClient';
import type { PlanPhaseView } from '@/plan/plan-core';

vi.mock('@/hooks/useMmaDispatch', () => ({
  useMmaDispatch: () => ({
    transition: vi.fn(async () => {}), dispatch: vi.fn(async () => {}),
    busyHandlers: new Set<string>(), busyRef: { current: new Set<string>() }, waitFor: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p1/plan',
  useSearchParams: () => new URLSearchParams(),
}));

const task = (id: string, dbStatus: string) => ({
  id, num: 1, title: `Task ${id}`, body: 'body', targetRepo: 'main',
  files: [], dependsOn: [], dbStatus,
});
const phases = (dbStatus: string): PlanPhaseView[] =>
  [{ id: 'ph1', title: 'Phase 1', tasks: [task('t1', dbStatus)] }] as unknown as PlanPhaseView[];

const renderPlan = (dbStatus: string) =>
  render(
    <PlanStageClient
      {...({
        projectId: 'p1', projectName: 'Payments', mmaReady: true,
        phases: phases(dbStatus), planMd: '# Plan', auditRounds: [],
        initialPhase: 'refine',
      } as unknown as PlanStageClientProps)}
    />,
  );

/**
 * Task approval is monotonic — `approve_task` is one-way and `onToggleApprove` returns
 * immediately for an already-approved task. The UI offered "Revoke" and "Revoke all"
 * anyway: enabled controls that did nothing when clicked. JournalStageClient already
 * handles its equally one-way learning approvals by showing a static state.
 */
describe('PlanStageClient approvals are one-way', () => {
  it('offers Approve while a task is unapproved', () => {
    renderPlan('proposed');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
  });

  it('shows a static Approved state instead of a Revoke button', () => {
    renderPlan('approved');
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('disables Approve all once everything is approved, rather than offering Revoke all', () => {
    renderPlan('approved');
    const bulk = screen.getByRole('button', { name: /Approve all/ });
    expect(bulk).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Revoke all/ })).toBeNull();
  });
});
