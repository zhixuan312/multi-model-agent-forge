import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JournalStageClient, type JournalLearningView } from '@/components/forge/JournalStageClient';

const { transition } = vi.hoisted(() => ({ transition: vi.fn(async () => {}) }));
vi.mock('@/hooks/useMmaDispatch', () => ({
  useMmaDispatch: () => ({ transition, dispatch: vi.fn(), busyHandlers: new Set<string>() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p1/reflect',
  useSearchParams: () => new URLSearchParams(),
}));

const learning = (over: Partial<JournalLearningView> = {}): JournalLearningView => ({
  id: 'l1', num: 1, title: 'Ship behind a flag', body: 'Body text.',
  category: 'decision', status: 'proposed', ...over,
});

const renderStage = (learnings: JournalLearningView[]) =>
  render(
    <JournalStageClient
      projectId="p1"
      learnings={learnings}
      harvesting={false}
      recording={false}
    />,
  );

/**
 * Remove destroys a harvested learning outright. It was a single click straight to
 * deletion — the only irreversible action in the stage with no guard — while MemberTable's
 * delete and FormPanel's `destructive` slot both use a two-step confirm.
 */
describe('JournalStageClient — removing a learning', () => {
  beforeEach(() => transition.mockClear());

  it('does not delete on the first click; it asks', () => {
    renderStage([learning()]);
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));

    expect(transition).not.toHaveBeenCalled();
    expect(screen.getByText('Remove permanently?')).toBeInTheDocument();
  });

  it('deletes only after confirming', () => {
    renderStage([learning()]);
    fireEvent.click(screen.getByRole('button', { name: /^Remove$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));

    expect(transition).toHaveBeenCalledWith('remove_learning', { rowId: 'l1' });
  });

  it('Keep backs out without deleting', () => {
    renderStage([learning()]);
    fireEvent.click(screen.getByRole('button', { name: /^Remove$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(transition).not.toHaveBeenCalled();
    expect(screen.queryByText('Remove permanently?')).toBeNull();
  });

  it('offers no curate controls once a learning is recorded — those rows are immutable', () => {
    renderStage([learning({ status: 'recorded' })]);
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });
});

describe('JournalStageClient — editing a learning', () => {
  beforeEach(() => transition.mockClear());

  it('names both editors, so they are not identified by a placeholder that vanishes on input', () => {
    renderStage([learning()]);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));

    expect(screen.getByRole('textbox', { name: 'Learning heading' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Learning body' })).toBeInTheDocument();
  });

  it('cannot save an empty heading or body', () => {
    renderStage([learning()]);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Learning heading' }), { target: { value: '  ' } });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('saves the trimmed heading and body', () => {
    renderStage([learning()]);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Learning heading' }), { target: { value: '  New heading  ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Learning body' }), { target: { value: '  New body  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(transition).toHaveBeenCalledWith('edit_learning', { rowId: 'l1', heading: 'New heading', body: 'New body' });
  });
});

describe('JournalStageClient — the auto-harvest', () => {
  beforeEach(() => { transition.mockClear(); });

  /**
   * `harvesting` included `learnings.length === 0 && !props.harvesting` as a disjunct. That
   * is a CONDITION, not a run: it stays true after the dispatch errors, so the stage showed
   * "Harvesting learnings from the project run..." with a spinner forever for a harvest that
   * had already failed — and the mount-only effect never retries. The one way back (the
   * "Harvest learnings" button) was unreachable, because the same disjunct made `harvesting`
   * true in exactly the situation that button exists for.
   */
  it('falls back to a retryable empty state when the harvest fails', async () => {
    transition.mockRejectedValueOnce(new Error('mma down'));
    render(
      <JournalStageClient projectId="p1" learnings={[]} harvesting={false} recording={false} />,
    );

    expect(transition).toHaveBeenCalledWith('dispatch_harvest');
    // The spinner is shown while it runs...
    expect(screen.getByText(/Harvesting learnings from the project run/)).toBeInTheDocument();
    // ...and gives way to something the user can act on when it does not.
    expect(await screen.findByText('No learnings yet')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /Harvest learnings/ });
    expect(retry).toBeEnabled();

    fireEvent.click(retry);
    expect(transition).toHaveBeenCalledTimes(2);
  });

  it('does not auto-harvest a project that already has learnings', () => {
    renderStage([learning()]);
    expect(transition).not.toHaveBeenCalled();
  });

  /**
   * `activeId` seeds from `?learning=<id>`. A link to a learning that has since been removed
   * left `active` undefined WITH learnings present, which rendered "No learnings yet" and a
   * Harvest button on a project full of them.
   */
  it('shows the list when the linked learning no longer exists', () => {
    render(
      <JournalStageClient
        projectId="p1"
        learnings={[learning()]}
        harvesting={false}
        recording={false}
        activeLearningId="deleted-long-ago"
      />,
    );

    expect(screen.queryByText('No learnings yet')).toBeNull();
    // Named in both the rail list and the document header, hence getAllByText.
    expect(screen.getAllByText('Ship behind a flag').length).toBeGreaterThan(0);
    expect(transition).not.toHaveBeenCalled();
  });
});

describe('JournalStageClient — recording to the journal', () => {
  beforeEach(() => { transition.mockClear(); });

  const approved = () => [learning({ status: 'kept' })];

  /**
   * This dispatched `dispatch_record` and called `setPhase('summary')` in the same tick, so a
   * failed record landed the user on "Recording learnings and computing the summary…" — a
   * spinner for work that had already errored, with no summary coming and no way back but
   * the stepper.
   */
  it('stays on the learnings list when the record fails', async () => {
    transition.mockRejectedValueOnce(new Error('mma down'));
    render(
      <JournalStageClient projectId="p1" learnings={approved()} harvesting={false} recording={false} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Continue to Summary/ }));
    expect(transition).toHaveBeenCalledWith('dispatch_record');

    await screen.findByRole('button', { name: /Continue to Summary/ });
    expect(screen.queryByText(/Recording learnings and computing the summary/)).toBeNull();
  });

  it('moves to the summary once the record lands', async () => {
    render(
      <JournalStageClient projectId="p1" learnings={approved()} harvesting={false} recording={false} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Continue to Summary/ }));
    // No summary has arrived from the server yet, so the computing state is correct here —
    // it now means "the record succeeded and the summary is on its way", not "something
    // failed silently".
    expect(await screen.findByText(/Recording learnings and computing the summary/)).toBeInTheDocument();
  });
});
