import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/forge/Sidebar';
import type { AuthedMember } from '@/auth/auth-provider';

vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
  // Sidebar now renders AccountMenu (footer), which uses useRouter for sign-out.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const admin: AuthedMember = {
  id: 'a1',
  username: 'maya',
  displayName: 'Maya Adeyemi',
  avatarTint: '#6A6F8C',
  isAdmin: true,
};
const nonAdmin: AuthedMember = { ...admin, id: 'm1', username: 'devon', displayName: 'Devon Vance', isAdmin: false };

describe('Sidebar', () => {
  it('renders the full primary nav for an admin', () => {
    render(<Sidebar member={admin} />);
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Loops')).toBeInTheDocument();
    expect(screen.getByText('Journal')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Team settings')).toBeInTheDocument();
    // The account menu + notification bell live in the global top-right cluster
    // now, not the rail — so the sidebar carries no user-card / admin-chip.
    expect(screen.queryByTestId('user-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-chip')).not.toBeInTheDocument();
  });

  it('hides admin-only items (Loops, Team settings) for a non-admin', () => {
    render(<Sidebar member={nonAdmin} />);
    expect(screen.queryByText('Loops')).not.toBeInTheDocument();
    expect(screen.queryByText('Team settings')).not.toBeInTheDocument();
    // Non-admin still sees the everyone-items.
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Journal')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('marks the active route with aria-current', () => {
    render(<Sidebar member={admin} />);
    const projects = screen.getByText('Projects').closest('a');
    expect(projects).toHaveAttribute('aria-current', 'page');
    const workspace = screen.getByText('Workspace').closest('a');
    expect(workspace).not.toHaveAttribute('aria-current');
  });
});
