import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileForm } from '../../app/(app)/profile/ProfileForm';
import type { AuthedMember } from '@/auth/auth-provider';

const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
}));

const me: AuthedMember = {
  id: 'm1',
  username: 'maya',
  displayName: 'Maya Adeyemi',
  avatarTint: '#6A6F8C',
  isAdmin: false,
};

describe('ProfileForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockClear();
    push.mockClear();
  });

  it('renders the username read-only (the login key, F23)', () => {
    render(<ProfileForm member={me} />);
    const username = screen.getByLabelText(/username/i) as HTMLInputElement;
    expect(username).toHaveAttribute('readonly');
    expect(username.value).toBe('maya');
  });

  it('rejects a short new password client-side without calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<ProfileForm member={me} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a mismatched confirmation without calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<ProfileForm member={me} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-strong-password-1234' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-different-password-99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets the member pick an avatar tint (radiogroup)', () => {
    render(<ProfileForm member={me} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeGreaterThan(1);
    // the current tint is checked
    expect(radios.some((r) => r.getAttribute('aria-checked') === 'true')).toBe(true);
  });

  it('shows the default schema avatar tint (#9a6b4f) as a selected swatch', () => {
    render(<ProfileForm member={{ ...me, avatarTint: '#9a6b4f' }} />);
    expect(screen.getByRole('radio', { checked: true })).toHaveAttribute(
      'aria-label',
      'Avatar colour #9a6b4f',
    );
  });

  it('exposes a username field inside the Password form for password managers', () => {
    render(<ProfileForm member={me} />);
    const pwForm = screen.getByRole('form', { name: 'Password' });
    const username = pwForm.querySelector('input[autocomplete="username"]') as HTMLInputElement | null;
    expect(username).not.toBeNull();
    expect(username!.value).toBe('maya');
  });

  it('refreshes and reports other devices were signed out after a password change', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    render(<ProfileForm member={me} />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password-1234' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-strong-password-1234' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-strong-password-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText(/other devices/i)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
