import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemberForm, type MemberRowData } from '../../app/(app)/settings/members/MemberTable';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const admin: MemberRowData = {
  id: 'm1',
  username: 'jane.wong',
  displayName: 'Jane Wong',
  avatarTint: '#6A6F8C',
  isAdmin: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

describe('MemberForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requires a confirmation before deleting — the first click sends no request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    render(<MemberForm mode="edit" existing={admin} isLastAdmin={false} onDone={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(fetchSpy).not.toHaveBeenCalled(); // no immediate delete

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('locks delete + role changes for the last remaining admin', () => {
    render(<MemberForm mode="edit" existing={admin} isLastAdmin onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByText(/only admin/i)).toBeInTheDocument();
  });

  it('exposes a Role selector when adding a member and sends isAdmin in the request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 201 }));
    render(<MemberForm mode="add" onDone={() => {}} />);

    expect(screen.getByLabelText('Role')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'New Member' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new.member' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-strong-password-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save member' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toHaveProperty('isAdmin');
  });

  it('copies the entered password to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MemberForm mode="add" onDone={() => {}} />);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'generated-pass-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('generated-pass-1234');
  });
});
