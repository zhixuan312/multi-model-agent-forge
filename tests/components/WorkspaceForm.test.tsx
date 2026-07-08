import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkspaceForm } from '../../app/(app)/settings/team/WorkspaceForm';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

describe('WorkspaceForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it('shows the current path and keeps Save disabled until it changes', () => {
    render(<WorkspaceForm current="/forge/base/alpha" />);
    const input = screen.getByLabelText(/workspace root path/i) as HTMLInputElement;
    expect(input.value).toBe('/forge/base/alpha');
    expect(screen.getByRole('button', { name: /save path/i })).toBeDisabled();
  });

  it('PUTs the new path to /api/team/workspace and refreshes on success', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ workspaceRootPath: '/forge/base/beta' }), { status: 200 }));
    render(<WorkspaceForm current="/forge/base/alpha" />);
    fireEvent.change(screen.getByLabelText(/workspace root path/i), { target: { value: '/forge/base/beta' } });
    fireEvent.click(screen.getByRole('button', { name: /save path/i }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/team/workspace', expect.objectContaining({ method: 'PUT' })),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('surfaces the API validation error and does not refresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'must be a direct child of the operator workspace base' }), { status: 400 }),
    );
    render(<WorkspaceForm current="/forge/base/alpha" />);
    fireEvent.change(screen.getByLabelText(/workspace root path/i), { target: { value: '/etc/evil' } });
    fireEvent.click(screen.getByRole('button', { name: /save path/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/direct child/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
