import { vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WorkspaceClient, type RepoCardData } from '../../app/(app)/workspace/WorkspaceClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const REPOS: RepoCardData[] = [
  { id: 'a', name: 'core-api', kind: 'library', tags: ['core', 'backend'], defaultBranch: 'main', status: 'cloned', headSha: 'abcdef1234' },
  { id: 'b', name: 'web', kind: 'service', tags: ['frontend'], defaultBranch: 'main', status: 'pulling', headSha: null },
  { id: 'c', name: 'core-docs', kind: 'docs', tags: ['core'], defaultBranch: 'main', status: 'error', headSha: null },
];

describe('WorkspaceClient filter island (Flow E)', () => {
  it('renders all repo cards initially', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    expect(screen.getByTestId('repo-core-api')).toBeInTheDocument();
    expect(screen.getByTestId('repo-web')).toBeInTheDocument();
    expect(screen.getByTestId('repo-core-docs')).toBeInTheDocument();
  });

  it('search="core" shows core-api + core-docs, not web', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'core' } });
    expect(screen.getByTestId('repo-core-api')).toBeInTheDocument();
    expect(screen.getByTestId('repo-core-docs')).toBeInTheDocument();
    expect(screen.queryByTestId('repo-web')).toBeNull();
  });

  it('kind=library + tag=core + search=api narrows to core-api only', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'library' } });
    fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'core' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'api' } });
    expect(screen.getByTestId('repo-core-api')).toBeInTheDocument();
    expect(screen.queryByTestId('repo-web')).toBeNull();
    expect(screen.queryByTestId('repo-core-docs')).toBeNull();
  });

  it('status chips carry a text label + aria-label, not colour alone (a11y F6)', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    const cloned = within(screen.getByTestId('repo-core-api')).getByRole('status');
    expect(cloned).toHaveAccessibleName(/Cloned/i);
    const pulling = within(screen.getByTestId('repo-web')).getByRole('status');
    expect(pulling).toHaveAccessibleName(/Pulling/i);
    const errored = within(screen.getByTestId('repo-core-docs')).getByRole('status');
    expect(errored).toHaveAccessibleName(/Error/i);
  });

  it('hides the admin clone + pull/remove controls for non-admins', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    expect(screen.queryByText('Add / clone repo')).toBeNull();
    expect(within(screen.getByTestId('repo-core-api')).queryByText('Pull')).toBeNull();
  });

  it('shows the admin add/clone control for admins', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin />);
    expect(screen.getByText('Add / clone repo')).toBeInTheDocument();
  });
});
