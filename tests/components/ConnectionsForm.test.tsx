import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  ConnectionsForm,
  type ConnectionsData,
} from '../../app/(app)/settings/connections/ConnectionsForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const empty: ConnectionsData = {
  mmaBaseUrl: null,
  openaiTranscriptionKeySet: false,
};

const openCard = (name: 'MMA' | 'Speech to text') =>
  fireEvent.click(screen.getByRole('button', { name: `Edit ${name}` }));

describe('ConnectionsForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads on load: shows org indicators + Edit buttons, no git card (git is team-owned)', () => {
    render(<ConnectionsForm initial={empty} mmaBearer={null} />);
    expect(screen.getByTestId('openai-key-indicator')).toBeInTheDocument();
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit MMA' })).toBeInTheDocument();
    // Git token moved to Team settings — it must NOT appear on the org connection surface.
    expect(screen.queryByTestId('git-token-indicator')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Git' })).not.toBeInTheDocument();
  });

  it('opening MMA reveals the form, base URL prefilled with the loopback default', () => {
    render(<ConnectionsForm initial={empty} mmaBearer={null} />);
    openCard('MMA');
    const url = screen.getByLabelText('Base URL') as HTMLInputElement;
    expect(url.value).toBe('http://127.0.0.1:7337');
  });

  it('shows the MMA bearer read-only, sourced from the local mma token', () => {
    render(<ConnectionsForm initial={empty} mmaBearer="local-token-xyz" />);
    openCard('MMA');
    const bearer = screen.getByLabelText(/Bearer token/) as HTMLInputElement;
    expect(bearer).toHaveAttribute('readonly');
    expect(bearer.value).toBe('local-token-xyz');
  });

  it('the MMA section saves base URL alone (never sends a token)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<ConnectionsForm initial={empty} mmaBearer="tok" />);
    openCard('MMA');
    fireEvent.submit(screen.getByRole('form', { name: 'MMA connection' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.mmaBaseUrl).toBe('http://127.0.0.1:7337');
    expect('mmaToken' in body).toBe(false);
    expect('gitToken' in body).toBe(false);
  });

  /**
   * The save error was rendered by this file, below BOTH panels, in markup identical to
   * what `FormPanel` already renders from its own `error` prop — the two panels' errors
   * appeared in the same place regardless of which one failed. It also carried an
   * `id="connections-error"` for an `aria-describedby` that was never written.
   */
  it('shows a save failure inside the panel that failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Base URL must be http(s).' }), { status: 400 }),
    );
    render(<ConnectionsForm initial={empty} mmaBearer="tok" />);
    openCard('MMA');
    fireEvent.submit(screen.getByRole('form', { name: 'MMA connection' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Base URL must be http(s).');
    expect(within(screen.getByRole('form', { name: 'MMA connection' })).getByRole('alert')).toBe(alert);
  });

  it('leaves no stray error id behind for an association nothing makes', () => {
    const { container } = render(<ConnectionsForm initial={empty} mmaBearer="tok" />);
    expect(container.querySelector('#connections-error')).toBeNull();
  });
});
