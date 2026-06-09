import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddMemberForm } from '../../app/(app)/settings/members/AddMemberForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

describe('AddMemberForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders labelled fields for display name, username, and password', () => {
    render(<AddMemberForm />);
    expect(screen.getByLabelText('Display name')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('validates a weak password client-side without calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<AddMemberForm />);
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jordan Wu' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jordan' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('generate fills the password field with a long value', () => {
    render(<AddMemberForm />);
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'generate' }));
    expect(pw.value.length).toBeGreaterThanOrEqual(12);
  });

  it('submits to POST /api/members on valid input', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 201 }));
    render(<AddMemberForm />);
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jordan Wu' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jordan' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-strong-password-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/members');
    expect((init as RequestInit).method).toBe('POST');
  });
});
