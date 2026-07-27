import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/forge/Sidebar';
import { GUIDE_NAV_SECTIONS, GUIDE_PARTS } from '@/content/guide-nav';
import type { AuthedMember } from '@/auth/auth-provider';

const pathname = { current: '/projects' };
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  // Sidebar now renders AccountMenu (footer), which uses useRouter for sign-out.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  pathname.current = '/projects';
});

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

  it('shows exactly one Guide link to every authenticated role', () => {
    for (const who of [orgAdmin, teamAdmin, member]) {
      const { unmount } = render(<Sidebar member={who} />);
      const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/settings/guide');
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveTextContent('Guide');
      unmount();
    }
  });

  it('keeps the Guide section rail collapsed outside the Guide area', () => {
    render(<Sidebar member={member} />);
    expect(screen.queryByText(GUIDE_NAV_SECTIONS[0].title)).not.toBeInTheDocument();
  });

  it('expands the part-grouped section rail while inside the Guide area', () => {
    pathname.current = `/settings/guide/${GUIDE_NAV_SECTIONS[1].id}`;
    render(<Sidebar member={member} />);

    for (const part of GUIDE_PARTS) {
      expect(screen.getByText(part.title)).toBeInTheDocument();
    }
    for (const section of GUIDE_NAV_SECTIONS) {
      const link = screen.getByText(section.title).closest('a');
      expect(link).toHaveAttribute('href', `/settings/guide/${section.id}`);
    }

    // Only the open section is current; the Guide item itself keeps the accent bar.
    expect(screen.getByText(GUIDE_NAV_SECTIONS[1].title).closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(GUIDE_NAV_SECTIONS[0].title).closest('a')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Guide').closest('a')).toHaveAttribute('aria-current', 'page');
  });

  it('marks the active route with aria-current', () => {
    render(<Sidebar member={member} />);
    const projects = screen.getByText('Projects').closest('a');
    expect(projects).toHaveAttribute('aria-current', 'page');
    const workspace = screen.getByText('Workspace').closest('a');
    expect(workspace).not.toHaveAttribute('aria-current');
  });
});
