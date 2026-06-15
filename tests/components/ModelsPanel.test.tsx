import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ModelsPanel } from '../../app/(app)/settings/models/ModelsPanel';
import type { MmaTiers } from '@/mma/mma-config-reader';
import type { FlatProfile } from '@/mma/model-profiles';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const tiers: MmaTiers = {
  main: { dialect: 'claude', model: 'claude-opus-4-8', baseUrl: null, authMode: 'oauth' },
  complex: null,
  standard: { dialect: 'codex', model: 'gpt-5.5', baseUrl: null, authMode: 'api-key' },
};
const suggestions: FlatProfile[] = [];

const verifyResponse = {
  verified: true,
  reason: 'recognized',
  applied: false,
  tier: 'main',
  provider: 'claude',
  model: { id: 'claude-opus-4-8', family: 'claude', tier: 'main', recognized: true },
  probe: { reachable: true, modelListed: true, detail: 'ok' },
};

function openTier(name: 'Main' | 'Complex' | 'Standard') {
  // each tier card has an Edit button; pick the one inside the card with that title
  const heading = screen.getByText(name);
  const card = heading.closest('div')!.parentElement!.parentElement!;
  fireEvent.click(within(card).getByRole('button', { name: /edit/i }));
}

describe('ModelsPanel', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.restoreAllMocks();
  });

  it('renders all three tiers; shows current config or "not configured"', () => {
    render(<ModelsPanel tiers={tiers} suggestions={suggestions} />);
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('Complex')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument();
    expect(screen.getByText('— not configured')).toBeInTheDocument(); // complex
  });

  it('Edit opens the configure form; Apply is disabled until validated', () => {
    render(<ModelsPanel tiers={tiers} suggestions={suggestions} />);
    openTier('Main');
    expect(screen.getByRole('button', { name: /validate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
  });

  it('Validate POSTs dryRun:true and, on a verified result, enables Apply', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(verifyResponse), { status: 200 }));
    render(<ModelsPanel tiers={tiers} suggestions={suggestions} />);
    openTier('Main');
    fireEvent.click(screen.getByRole('button', { name: /validate/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/configure-provider');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ tier: 'main', provider: 'claude', model: 'claude-opus-4-8', dryRun: true });
    await waitFor(() => expect(screen.getByRole('button', { name: /apply/i })).toBeEnabled());
  });

  it('Apply POSTs dryRun:false after a successful validate', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ ...verifyResponse, applied: true }), { status: 200 }),
    );
    render(<ModelsPanel tiers={tiers} suggestions={suggestions} />);
    openTier('Main');
    fireEvent.click(screen.getByRole('button', { name: /validate/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /apply/i })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const body = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(body.dryRun).toBe(false);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
