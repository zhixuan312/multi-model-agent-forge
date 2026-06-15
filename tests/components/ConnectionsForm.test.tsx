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

const openCard = (name: 'MMA' | 'Git' | 'Speech to text') =>
  fireEvent.click(screen.getByRole('button', { name: `Edit ${name}` }));

describe('ConnectionsForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads on load: shows indicators + Edit buttons, no form fields yet', () => {
    render(<ConnectionsForm initial={empty} mmaBearer={null} />);
    expect(screen.getByTestId('git-token-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('openai-key-indicator')).toBeInTheDocument();
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit MMA' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Git' })).toBeInTheDocument();
  });

  it('opening MMA reveals the form, base URL prefilled with the loopback default', () => {
    render(<ConnectionsForm initial={empty} mmaBearer={null} />);
    openCard('MMA');
    const url = screen.getByLabelText('Base URL') as HTMLInputElement;
    expect(url.value).toBe('http://127.0.0.1:7337');
  });

  it('shows the MMA bearer read-only, sourced from the local mmagent token', () => {
    render(<ConnectionsForm initial={empty} mmaBearer="local-token-xyz" />);
    openCard('MMA');
    const bearer = screen.getByLabelText(/Bearer token/) as HTMLInputElement;
    expect(bearer).toHaveAttribute('readonly');
    expect(bearer.value).toBe('local-token-xyz');
  });

  it('git token input is write-only (password, never prefilled)', () => {
    render(<ConnectionsForm initial={{ ...empty, gitTokenSet: true }} mmaBearer={null} />);
    openCard('Git');
    const git = screen.getByLabelText(/Service token/) as HTMLInputElement;
    expect(git).toHaveAttribute('type', 'password');
    expect(git.value).toBe('');
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
  });

  it('the Git section validates an empty token client-side on save', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<ConnectionsForm initial={empty} mmaBearer={null} />);
    openCard('Git');
    fireEvent.submit(screen.getByRole('form', { name: 'Git connection' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/git service token/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
