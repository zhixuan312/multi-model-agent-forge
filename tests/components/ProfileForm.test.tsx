import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileForm } from '../../app/(app)/profile/ProfileForm';
import type { AuthedMember } from '@/auth/auth-provider';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const me: AuthedMember = {
  id: 'm1',
  username: 'maya',
  displayName: 'Maya Adeyemi',
  avatarTint: '#6A6F8C',
  isAdmin: false,
};

describe('ProfileForm', () => {
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
});
