import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TeamsPanel } from '../../app/(app)/settings/org/TeamsPanel';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const teams = [
  { id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/w/alpha', gitTokenSet: false, memberCount: 2, adminUsername: 'ada' },
];

describe('TeamsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it('lists teams (with their admin) and shows the create form on New team', () => {
    render(<TeamsPanel initialTeams={teams} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('@ada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /new team/i }));
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    // the create form provisions the team admin inline
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/initial password/i)).toBeInTheDocument();
  });

  it('creates a team together with its admin credentials', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'team-2' }), { status: 201 }));
    render(<TeamsPanel initialTeams={teams} />);
    fireEvent.click(screen.getByRole('button', { name: /new team/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Beta' } });
    fireEvent.change(screen.getByLabelText(/^slug$/i), { target: { value: 'beta' } });
    fireEvent.change(screen.getByLabelText(/workspace root path/i), { target: { value: '/w/beta' } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Bianca' } });
    fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: 'bianca' } });
    fireEvent.change(screen.getByLabelText(/initial password/i), { target: { value: 'a-strong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /create team \+ admin/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/teams', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      name: 'Beta',
      slug: 'beta',
      workspaceRootPath: '/w/beta',
      admin: { displayName: 'Bianca', username: 'bianca', password: 'a-strong-password' },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
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
