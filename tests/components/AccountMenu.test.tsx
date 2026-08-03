import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from '@/components/forge/AccountMenu';
import type { AuthedMember } from '@/auth/auth-provider';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const member = { id: 'm1', username: 'maya', displayName: 'Maya Adeyemi', role: 'member', avatarTint: '#c4521e' } as AuthedMember;

const open = async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(screen.getByRole('button', { name: 'Account menu' }));
  await screen.findByRole('menu');
  return user;
};

describe('AccountMenu', () => {
  it('offers exactly Profile and Sign out', async () => {
    render(<AccountMenu member={member} />);
    await open();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Profile', 'Sign out']);
  });

  it('routes to /login after signing out, and posts the logout first', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(<AccountMenu member={member} />);
    const user = await open();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    fetchSpy.mockRestore();
  });

  it('still reaches /login when the logout request fails', async () => {
    // A rejected POST used to throw before the redirect, leaving the menu stuck on
    // "Signing out…" forever.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    push.mockClear();
    render(<AccountMenu member={member} />);
    const user = await open();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    fetchSpy.mockRestore();
  });
});
