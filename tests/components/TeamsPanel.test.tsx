import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeamsPanel } from '../../app/(app)/settings/org/TeamsPanel';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const teams = [
  { id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/w/alpha', gitTokenSet: false, memberCount: 2 },
];

describe('TeamsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it('lists teams and shows the create form on New team', () => {
    render(<TeamsPanel initialTeams={teams} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /new team/i }));
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
  });

  it('expands a team, lists its members, and promotes one to team admin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/members')) {
        return new Response(JSON.stringify([{ id: 'm1', displayName: 'Ada', username: 'ada', isAdmin: false }]), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    });
    render(<TeamsPanel initialTeams={teams} />);
    fireEvent.click(screen.getByRole('button', { name: /members/i }));
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /make admin/i }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/teams/team-1/assign-admin',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
