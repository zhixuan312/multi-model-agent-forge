import { vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { WorkspaceClient, type RepoCardData } from '../../app/(app)/workspace/WorkspaceClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

/** Failures reach the user through the toast channel — capture them. */
const toasts: Array<{ type: string; message: string }> = [];
vi.mock('@/components/ui/toast', () => ({
  showToast: (t: { type: string; message: string }) => { toasts.push(t); },
  Toaster: () => null,
}));

beforeEach(() => {
  toasts.length = 0;
  vi.restoreAllMocks();
});

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

  /**
   * An empty WORKSPACE and an empty FILTER are different situations. The one message
   * covered both, so a team with no repos was told to "adjust the filters above" —
   * controls that cannot help — and a non-admin was told to clone one, which they cannot.
   */
  it('tells an admin with no repos to clone one, not to adjust filters', () => {
    render(<WorkspaceClient initialRepos={[]} isAdmin />);
    expect(screen.getByText('No repositories yet')).toBeInTheDocument();
    expect(screen.getByText(/Clone a repo/)).toBeInTheDocument();
    expect(screen.queryByText(/Adjust the search/)).not.toBeInTheDocument();
  });

  it('does not suggest cloning to someone who cannot clone', () => {
    render(<WorkspaceClient initialRepos={[]} isAdmin={false} />);
    expect(screen.getByText('No repositories yet')).toBeInTheDocument();
    expect(screen.getByText(/A team admin clones/)).toBeInTheDocument();
  });

  it('says "no match" only when repos exist but the filter excludes them', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin />);
    fireEvent.change(screen.getByLabelText('Search repos'), { target: { value: 'zzzz-no-such-repo' } });
    expect(screen.getByText('No repositories match')).toBeInTheDocument();
    expect(screen.getByText(/Adjust the search/)).toBeInTheDocument();
  });

  /**
   * The pull route answers a failure with the git reason (`{ error }` on its 502) — an
   * expired token, a missing remote. That was discarded for a flat "try again", the one
   * instruction that cannot work for those causes.
   */
  it('surfaces why a pull failed instead of saying "try again"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'remote: authentication failed' }), { status: 502 }),
    );
    render(<WorkspaceClient initialRepos={REPOS} isAdmin />);
    fireEvent.click(within(row('core-api')).getByRole('button', { name: 'Pull' }));
    await waitFor(() =>
      expect(toasts.at(-1)?.message).toBe('remote: authentication failed'),
    );
  });
});
