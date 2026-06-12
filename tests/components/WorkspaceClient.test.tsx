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
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'core' } });
    expect(screen.getByText('core-api')).toBeInTheDocument();
    expect(screen.getByText('core-docs')).toBeInTheDocument();
    expect(screen.queryByText('web')).toBeNull();
  });

  it('search="api" narrows to core-api only', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'api' } });
    expect(screen.getByText('core-api')).toBeInTheDocument();
    expect(screen.queryByText('web')).toBeNull();
    expect(screen.queryByText('core-docs')).toBeNull();
  });

  it('status chips carry a text label + aria-label, not colour alone (a11y F6)', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    expect(within(row('core-api')).getByRole('status')).toHaveAccessibleName(/Cloned/i);
    expect(within(row('web')).getByRole('status')).toHaveAccessibleName(/Pulling/i);
    expect(within(row('core-docs')).getByRole('status')).toHaveAccessibleName(/Error/i);
  });

  it('hides the clone form + row actions for non-admins', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin={false} />);
    expect(screen.queryByText('Add / clone repo')).toBeNull();
    expect(within(row('core-api')).queryByText('Pull')).toBeNull();
  });

  it('shows the admin clone form + row actions for admins', () => {
    render(<WorkspaceClient initialRepos={REPOS} isAdmin />);
    expect(screen.getByText('Add / clone repo')).toBeInTheDocument();
    expect(within(row('core-api')).getByText('Pull')).toBeInTheDocument();
  });
});
