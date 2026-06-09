import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ProvidersPanel,
  ProviderForm,
  type ProviderViewData,
} from '../../app/(app)/settings/providers/ProvidersPanel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

describe('ProviderForm / ProvidersPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders labelled fields (type, name, base URL, API key)', () => {
    render(<ProviderForm mode="add" onDone={vi.fn()} />);
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Base URL/)).toBeInTheDocument();
    expect(screen.getByLabelText(/API key/)).toBeInTheDocument();
  });

  it('the type selector offers the two dialect labels', () => {
    render(<ProviderForm mode="add" onDone={vi.fn()} />);
    expect(screen.getByText(/claude · Anthropic-style/)).toBeInTheDocument();
    expect(screen.getByText(/codex · OpenAI-style/)).toBeInTheDocument();
  });

  it('validates an empty name client-side without calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<ProviderForm mode="add" onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/name is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('submits to POST /api/providers and only sends apiKey when non-empty', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 201 }));
    render(<ProviderForm mode="add" onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Minimax' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save provider' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/providers');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.name).toBe('Minimax');
    // apiKey omitted when blank (write-only).
    expect('apiKey' in body).toBe(false);
  });

  it('edit form shows the api-key field as set-but-keepable (not the value)', () => {
    const existing: ProviderViewData = {
      id: 'p1',
      name: 'Claude',
      type: 'claude',
      baseUrl: null,
      apiKeySet: true,
    };
    render(<ProviderForm mode="edit" existing={existing} onDone={vi.fn()} />);
    const keyInput = screen.getByLabelText(/API key/) as HTMLInputElement;
    expect(keyInput.value).toBe(''); // write-only — never prefilled with the secret
    expect(keyInput).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/API key/).closest('div')).toHaveTextContent(/blank keeps it/i);
  });

  it('the panel shows a "set / not set" indicator per provider (not the key)', () => {
    const rows: ProviderViewData[] = [
      { id: 'a', name: 'Claude', type: 'claude', baseUrl: null, apiKeySet: false },
      { id: 'b', name: 'Minimax', type: 'codex', baseUrl: 'https://x', apiKeySet: true },
    ];
    render(<ProvidersPanel initial={rows} />);
    const indicators = screen.getAllByTestId('apikey-indicator');
    expect(indicators[0]).toHaveTextContent('not set');
    expect(indicators[1]).toHaveTextContent('set');
  });
});
