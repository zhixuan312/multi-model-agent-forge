import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('RosterPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all three tiers with provider + model fields', () => {
    render(<RosterPanel initialRoster={roster} providers={providers} />);
    for (const tier of ['main', 'complex', 'standard'] as const) {
      expect(screen.getByTestId(`tier-${tier}`)).toBeInTheDocument();
      expect(screen.getByLabelText('Provider', { selector: `#provider-${tier}` })).toBeInTheDocument();
      expect(screen.getByLabelText(/Model/, { selector: `#model-${tier}` })).toBeInTheDocument();
    }
  });

  it('the provider select lists configured providers + a none option', () => {
    render(<RosterPanel initialRoster={roster} providers={providers} />);
    const select = screen.getByLabelText('Provider', { selector: '#provider-main' });
    expect(select).toHaveTextContent('— none');
    expect(select).toHaveTextContent('Claude');
    expect(select).toHaveTextContent('Minimax');
  });

  it('the model field is free-text (accepts a custom id)', () => {
    render(<RosterPanel initialRoster={roster} providers={providers} />);
    const model = screen.getByLabelText(/Model/, { selector: '#model-complex' }) as HTMLInputElement;
    fireEvent.change(model, { target: { value: 'MiniMax-Text-01-custom' } });
    expect(model.value).toBe('MiniMax-Text-01-custom');
  });

  it('Save roster PUTs the whole roster to /api/roster', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    render(<RosterPanel initialRoster={roster} providers={providers} />);
    fireEvent.change(screen.getByLabelText('Provider', { selector: '#provider-complex' }), {
      target: { value: 'p1' },
    });
    fireEvent.change(screen.getByLabelText(/Model/, { selector: '#model-complex' }), {
      target: { value: 'claude-opus-4-8' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save roster' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/roster');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tiers).toHaveLength(3);
    const complex = body.tiers.find((t: { tier: string }) => t.tier === 'complex');
    expect(complex.providerId).toBe('p1');
    expect(complex.model).toBe('claude-opus-4-8');
  });
});
