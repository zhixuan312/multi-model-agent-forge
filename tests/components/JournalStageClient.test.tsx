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
