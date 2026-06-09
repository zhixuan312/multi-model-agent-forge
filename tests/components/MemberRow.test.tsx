import { vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemberRow, type MemberRowData } from '../../app/(app)/settings/members/MemberRow';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const adminRow: MemberRowData = {
  id: 'a1',
  username: 'maya',
  displayName: 'Maya Adeyemi',
  avatarTint: '#6A6F8C',
  isAdmin: true,
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
};
const plainRow: MemberRowData = { ...adminRow, id: 'm1', username: 'devon', displayName: 'Devon Vance', isAdmin: false };

describe('MemberRow', () => {
  it('renders username, display name, admin badge, and created date', () => {
    render(<MemberRow member={adminRow} />);
    expect(screen.getByText('Maya Adeyemi')).toBeInTheDocument();
    expect(screen.getByText('@maya')).toBeInTheDocument();
    expect(screen.getByTestId('admin-badge')).toBeInTheDocument();
    expect(screen.getByText(/Joined/)).toBeInTheDocument();
  });

  it('omits the admin badge for a non-admin', () => {
    render(<MemberRow member={plainRow} />);
    expect(screen.queryByTestId('admin-badge')).not.toBeInTheDocument();
  });

  it('opens a keyboard-operable action menu with the three actions', () => {
    render(<MemberRow member={plainRow} />);
    const trigger = screen.getByRole('button', { name: /actions for devon vance/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Make admin', 'Reset password', 'Delete']);
  });

  it('reset action reveals a labelled password field', () => {
    render(<MemberRow member={plainRow} />);
    fireEvent.click(screen.getByRole('button', { name: /actions for devon vance/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }));
    expect(screen.getByLabelText(/new password for @devon/i)).toBeInTheDocument();
  });
});

describe('Members list', () => {
  it('renders one row per member', () => {
    render(
      <div data-testid="list">
        <MemberRow member={adminRow} />
        <MemberRow member={plainRow} />
      </div>,
    );
    expect(screen.getAllByTestId('member-row')).toHaveLength(2);
  });
});
