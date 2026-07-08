import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/forge/Sidebar';
import type { AuthedMember } from '@/auth/auth-provider';

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  // Sidebar now renders AccountMenu (footer), which uses useRouter for sign-out.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const orgAdmin: AuthedMember = {
  id: 'a1',
  username: 'maya',
  displayName: 'Maya Adeyemi',
  avatarTint: '#6A6F8C',
  role: 'org_admin',
  teamId: null,
};
const teamAdmin: AuthedMember = { ...orgAdmin, id: 'ta1', role: 'team_admin', teamId: 'team-1' };
const member: AuthedMember = { ...orgAdmin, id: 'm1', username: 'devon', displayName: 'Devon Vance', role: 'member', teamId: 'team-1' };

describe('Sidebar role nav', () => {
  it('shows Usage to every role', () => {
    render(<Sidebar member={member} />);
    expect(screen.getByText('Usage')).toBeInTheDocument();
  });

  it('shows Org settings only to org_admin', () => {
    const { unmount } = render(<Sidebar member={orgAdmin} />);
    expect(screen.getByText('Org settings')).toBeInTheDocument();
    unmount();
  });

  it('shows org_admin only Usage and Org settings — no team-scoped nav', () => {
    render(<Sidebar member={orgAdmin} />);
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('Org settings')).toBeInTheDocument();
    for (const label of ['Projects', 'Loops', 'Journal', 'Workspace', 'Team settings']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('shows team members the team-scoped nav', () => {
    render(<Sidebar member={teamAdmin} />);
    for (const label of ['Projects', 'Journal', 'Workspace', 'Usage']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows Team settings to team_admin but not member', () => {
    const { unmount: unmount1 } = render(<Sidebar member={teamAdmin} />);
    expect(screen.getByText('Team settings')).toBeInTheDocument();
    unmount1();

    const { unmount: unmount2 } = render(<Sidebar member={member} />);
    expect(screen.queryByText('Team settings')).not.toBeInTheDocument();
    unmount2();
  });

  it('marks the active route with aria-current', () => {
    render(<Sidebar member={member} />);
    const projects = screen.getByText('Projects').closest('a');
    expect(projects).toHaveAttribute('aria-current', 'page');
    const workspace = screen.getByText('Workspace').closest('a');
    expect(workspace).not.toHaveAttribute('aria-current');
  });
});
