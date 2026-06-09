import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ConnectionsForm,
  type ConnectionsData,
} from '../../app/(app)/settings/connections/ConnectionsForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const empty: ConnectionsData = {
  mmaBaseUrl: null,
  mmaTokenSet: false,
  gitTokenSet: false,
  openaiTranscriptionKeySet: false,
};

describe('ConnectionsForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders MMA (base URL + bearer), Git (token) and OpenAI sections with labels', () => {
    render(<ConnectionsForm initial={empty} />);
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument();
    expect(screen.getByLabelText(/Bearer token/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Service token/)).toBeInTheDocument();
    expect(screen.getByLabelText(/API key/)).toBeInTheDocument();
  });

  it('prefills the MMA base URL with the loopback default when unset', () => {
    render(<ConnectionsForm initial={empty} />);
    const url = screen.getByLabelText('Base URL') as HTMLInputElement;
    expect(url.value).toBe('http://127.0.0.1:7337');
  });

  it('token inputs are write-only (password, never prefilled with a value)', () => {
    const set: ConnectionsData = {
      mmaBaseUrl: 'http://127.0.0.1:7337',
      mmaTokenSet: true,
      gitTokenSet: true,
      openaiTranscriptionKeySet: false,
    };
    render(<ConnectionsForm initial={set} />);
    const bearer = screen.getByLabelText(/Bearer token/) as HTMLInputElement;
    const git = screen.getByLabelText(/Service token/) as HTMLInputElement;
    expect(bearer).toHaveAttribute('type', 'password');
    expect(git).toHaveAttribute('type', 'password');
    expect(bearer.value).toBe('');
    expect(git.value).toBe('');
  });

  it('shows a "set / not set" indicator for each secret (not the value)', () => {
    const mixed: ConnectionsData = {
      mmaBaseUrl: 'http://127.0.0.1:7337',
      mmaTokenSet: true,
      gitTokenSet: false,
      openaiTranscriptionKeySet: false,
    };
    render(<ConnectionsForm initial={mixed} />);
    expect(screen.getByTestId('mma-token-indicator')).toHaveTextContent('set');
    expect(screen.getByTestId('git-token-indicator')).toHaveTextContent('not set');
  });

  it('the MMA section saves base URL alone (no token) without sending mmaToken', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    render(<ConnectionsForm initial={{ ...empty, mmaTokenSet: true }} />);
    // Submit the MMA form with no new token typed.
    const mmaForm = screen.getByRole('form', { name: 'MMA connection' });
    fireEvent.submit(mmaForm);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.mmaBaseUrl).toBe('http://127.0.0.1:7337');
    expect('mmaToken' in body).toBe(false); // blank token not sent
  });

  it('the Git section validates an empty token client-side', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<ConnectionsForm initial={empty} />);
    fireEvent.submit(screen.getByRole('form', { name: 'Git connection' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/git service token/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
