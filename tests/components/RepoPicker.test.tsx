import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoPicker, type RepoPickerRepo } from '@/components/forge/RepoPicker';

const repos: RepoPickerRepo[] = [
  { id: '1', name: 'eval-core', kind: 'service', tags: ['eval'], status: 'cloned' },
  { id: '2', name: 'eval-indicators', kind: 'library', tags: ['eval', 'ml'], status: 'cloned' },
  { id: '3', name: 'eval-tests', kind: 'tests', tags: ['eval'], status: 'cloned' },
  { id: '4', name: 'payments-api', kind: 'service', tags: ['payments'], status: 'cloned' },
  { id: '5', name: 'broken-repo', kind: 'service', tags: ['eval'], status: 'error' },
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
  it('search + kind + tag AND-combine to the expected subset', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Host />);
    // search "eval" → all eval-* + broken-repo (tag eval). kind "service" → eval-core, broken. tag "eval" both have it.
    fireEvent.change(screen.getByLabelText('Search repos'), { target: { value: 'eval' } });
    await user.click(screen.getByLabelText('Kind'));
    await user.click(await screen.findByRole('option', { name: 'service' }));
    await user.click(screen.getByLabelText('Tag'));
    await user.click(await screen.findByRole('option', { name: 'eval' }));
    // remaining rows: eval-core (service, tag eval) + broken-repo (service, tag eval)
    expect(screen.getByTestId('repo-row-eval-core')).toBeInTheDocument();
    expect(screen.getByTestId('repo-row-broken-repo')).toBeInTheDocument();
    expect(screen.queryByTestId('repo-row-eval-indicators')).not.toBeInTheDocument();
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
