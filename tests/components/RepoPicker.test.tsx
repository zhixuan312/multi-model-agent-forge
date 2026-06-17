import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoPicker, type RepoPickerRepo } from '@/components/forge/RepoPicker';

const repos: RepoPickerRepo[] = [
  { id: '1', name: 'eval-core', tags: ['eval'], status: 'cloned' },
  { id: '2', name: 'eval-indicators', tags: ['eval', 'ml'], status: 'cloned' },
  { id: '3', name: 'eval-tests', tags: ['eval'], status: 'cloned' },
  { id: '4', name: 'payments-api', tags: ['payments'], status: 'cloned' },
  { id: '5', name: 'broken-repo', tags: ['eval'], status: 'error' },
];

/** A tiny controlled host so the picker's onChange round-trips. */
function Host({ initial = [] as string[] }) {
  const [sel, setSel] = useState<string[]>(initial);
  return (
    <>
      <RepoPicker repos={repos} selected={sel} onChange={setSel} />
      <output data-testid="sel">{sel.join(',')}</output>
    </>
  );
}

describe('RepoPicker', () => {
  it('search + tag AND-combine to the expected subset', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Host />);
    // search "eval" → all eval-* + broken-repo (tag eval); payments-api excluded.
    // tag "ml" → only eval-indicators has it.
    fireEvent.change(screen.getByLabelText('Search repos'), { target: { value: 'eval' } });
    await user.click(screen.getByLabelText('Tag'));
    await user.click(await screen.findByRole('option', { name: 'ml' }));
    expect(screen.getByTestId('repo-row-eval-indicators')).toBeInTheDocument();
    expect(screen.queryByTestId('repo-row-eval-core')).not.toBeInTheDocument();
    expect(screen.queryByTestId('repo-row-broken-repo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('repo-row-payments-api')).not.toBeInTheDocument();
  });

  it('an errored repo is shown as unavailable and is non-selectable', () => {
    render(<Host />);
    const badCb = screen.getByLabelText('Select repository broken-repo') as HTMLInputElement;
    expect(badCb).toBeDisabled();
    expect(screen.getByTestId('repo-unavailable-broken-repo')).toBeInTheDocument();
    // clicking does nothing
    fireEvent.click(badCb);
    expect(screen.getByTestId('sel')).toHaveTextContent('');
  });

  it('toggling an available repo updates the selection', () => {
    render(<Host />);
    fireEvent.click(screen.getByLabelText('Select repository eval-core'));
    expect(screen.getByTestId('sel')).toHaveTextContent('1');
    fireEvent.click(screen.getByLabelText('Select repository eval-tests'));
    expect(screen.getByTestId('sel')).toHaveTextContent('1,3');
  });
});
