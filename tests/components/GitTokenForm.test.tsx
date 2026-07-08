import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GitTokenForm } from '../../app/(app)/settings/team/GitTokenForm';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

describe('GitTokenForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it('shows "not set" and reveals the token field on Edit', () => {
    render(<GitTokenForm tokenSet={false} />);
    expect(screen.getByText('not set')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit git token/i }));
    expect(screen.getByLabelText(/service token/i)).toBeInTheDocument();
  });

  it('PUTs the token to /api/connections and refreshes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(<GitTokenForm tokenSet />);
    fireEvent.click(screen.getByRole('button', { name: /edit git token/i }));
    fireEvent.change(screen.getByLabelText(/service token/i), { target: { value: 'ghp_secret' } });
    fireEvent.click(screen.getByRole('button', { name: /save token/i }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/connections', expect.objectContaining({ method: 'PUT' })),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
