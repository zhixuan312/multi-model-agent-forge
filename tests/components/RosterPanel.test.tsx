import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RosterPanel,
  type RosterRowData,
  type ProviderOption,
} from '../../app/(app)/settings/roster/RosterPanel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const roster: RosterRowData[] = [
  { tier: 'main', providerId: null, model: null },
  { tier: 'complex', providerId: null, model: null },
  { tier: 'standard', providerId: null, model: null },
];
const providers: ProviderOption[] = [
  { id: 'p1', name: 'Claude' },
  { id: 'p2', name: 'Minimax' },
];
const modelsByProvider: Record<string, string[]> = {
  p1: ['claude-opus-4-8', 'claude-sonnet-4-6'],
  p2: ['minimax-text-01'],
};

describe('RosterPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all three tiers with provider + model fields', () => {
    render(<RosterPanel initialRoster={roster} providers={providers} modelsByProvider={modelsByProvider} />);
    for (const tier of ['main', 'complex', 'standard'] as const) {
      expect(screen.getByTestId(`tier-${tier}`)).toBeInTheDocument();
      expect(screen.getByLabelText('Provider', { selector: `#provider-${tier}` })).toBeInTheDocument();
      expect(screen.getByLabelText(/Model/, { selector: `#model-${tier}` })).toBeInTheDocument();
    }
  });

  it('the provider select lists configured providers + a none option', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<RosterPanel initialRoster={roster} providers={providers} modelsByProvider={modelsByProvider} />);
    await user.click(screen.getByLabelText('Provider', { selector: '#provider-main' }));
    expect(await screen.findByRole('option', { name: '— none' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Minimax' })).toBeInTheDocument();
  });

  it('the model field is constrained to the chosen provider’s models', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<RosterPanel initialRoster={roster} providers={providers} modelsByProvider={modelsByProvider} />);
    const model = screen.getByLabelText(/Model/, { selector: '#model-complex' });
    // disabled until a provider is chosen
    expect(model).toBeDisabled();
    await user.click(screen.getByLabelText('Provider', { selector: '#provider-complex' }));
    await user.click(await screen.findByRole('option', { name: 'Claude' }));
    expect(model).not.toBeDisabled();
    // the model select now offers only p1's models
    await user.click(model);
    expect(await screen.findByRole('option', { name: 'claude-opus-4-8' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'claude-sonnet-4-6' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'minimax-text-01' })).toBeNull();
  });

  it('saving a tier card PUTs only that tier to /api/roster', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    render(<RosterPanel initialRoster={roster} providers={providers} modelsByProvider={modelsByProvider} />);
    await user.click(screen.getByLabelText('Provider', { selector: '#provider-complex' }));
    await user.click(await screen.findByRole('option', { name: 'Claude' }));
    await user.click(screen.getByLabelText(/Model/, { selector: '#model-complex' }));
    await user.click(await screen.findByRole('option', { name: 'claude-opus-4-8' }));
    // each tier card has its own Save — click the complex card's
    fireEvent.click(within(screen.getByTestId('tier-complex')).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/roster');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tiers).toHaveLength(1);
    expect(body.tiers[0].tier).toBe('complex');
    expect(body.tiers[0].providerId).toBe('p1');
    expect(body.tiers[0].model).toBe('claude-opus-4-8');
  });
});
