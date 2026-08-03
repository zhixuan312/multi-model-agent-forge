import { vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WorkspaceClient, type RepoCardData } from '../../app/(app)/workspace/WorkspaceClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const REPOS: RepoCardData[] = [
  { id: 'a', name: 'core-api', tags: ['core', 'backend'], defaultBranch: 'main', status: 'cloned', headSha: 'abcdef1234' },
  { id: 'b', name: 'web', tags: ['frontend'], defaultBranch: 'main', status: 'pulling', headSha: null },
  { id: 'c', name: 'core-docs', tags: ['core'], defaultBranch: 'main', status: 'error', headSha: null },
];

/** The table row that contains a repo name. */
const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('WorkspaceClient filter island (Flow E)', () => {
  it('renders all repos in the table initially', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    expect(screen.getByText('core-api')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.getByText('core-docs')).toBeInTheDocument();
  });

  it('search="core" shows core-api + core-docs, not web', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    fireEvent.change(screen.getByLabelText('Search repos'), { target: { value: 'core' } });
    expect(screen.getByText('core-api')).toBeInTheDocument();
    expect(screen.getByText('core-docs')).toBeInTheDocument();
    expect(screen.queryByText('web')).toBeNull();
  });

  it('search="api" narrows to core-api only', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    fireEvent.change(screen.getByLabelText('Search repos'), { target: { value: 'api' } });
    expect(screen.getByText('core-api')).toBeInTheDocument();
    expect(screen.queryByText('web')).toBeNull();
    expect(screen.queryByText('core-docs')).toBeNull();
  });

  it('status chips carry a TEXT label, not colour alone (a11y F6)', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    expect(within(row('core-api')).getByText('Cloned')).toBeInTheDocument();
    expect(within(row('web')).getByText('Pulling…')).toBeInTheDocument();
    expect(within(row('core-docs')).getByText('Error')).toBeInTheDocument();
  });

  /**
   * The chip is a table CELL, so `role="status"` made every repo row its own polite live
   * region. The `aria-label` that came with it was prohibited too — `Badge` renders a
   * `<span>`, and a label is not allowed on the implicit `generic` role — and it
   * overrode the visible text with a near-copy of it. The "Status" column header already
   * supplies the context it was spelling out.
   */
  it('does not turn every repo row into a live region', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('hides the New-repo button + row actions for non-admins', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    expect(screen.queryByText('New repo')).toBeNull();
    expect(within(row('core-api')).queryByText('Pull')).toBeNull();
  });

  it('shows the New-repo button + row actions for admins', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin />);
    expect(screen.getByText('New repo')).toBeInTheDocument();
    expect(within(row('core-api')).getByText('Pull')).toBeInTheDocument();
  });

  it('disables Pull for a repo already pulling server-side (busy state survives navigation) [QA F4]', () => {
    // 'web' loads with status='pulling' — a pull is in flight. Even on a fresh mount (local
    // busyId unset), the Pull button must stay disabled, reconstructed from the row status,
    // so navigating away and back can't fire a second concurrent pull.
    render(<WorkspaceClient initialRepos={REPOS} isAdmin />);
    expect(within(row('web')).getByRole('button', { name: 'Pull' })).toBeDisabled();
    // A cloned repo's Pull is enabled.
    expect(within(row('core-api')).getByRole('button', { name: 'Pull' })).toBeEnabled();
  });

  it('"New repo" reveals the inline clone form at the top of the table', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin />);
    expect(screen.queryByLabelText('Clone repo')).toBeNull();
    fireEvent.click(screen.getByText('New repo'));
    expect(screen.getByLabelText('Clone repo')).toBeInTheDocument();
    expect(screen.getByText('Clone repo')).toBeInTheDocument(); // submit button
  });

  it('Delete is inside the edit form with two-step confirmation', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin />);
    fireEvent.click(within(row('core-api')).getByText('Edit'));
    expect(screen.getByText('Delete')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Remove this repo?')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Keep')).toBeInTheDocument();
  });
});
