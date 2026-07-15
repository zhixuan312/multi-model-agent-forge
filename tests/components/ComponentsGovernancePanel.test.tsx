import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentsGovernancePanel } from '../../app/(app)/settings/components/ComponentsGovernancePanel';
import type { ComponentGovernanceView } from '@/components/governance/registry';

const initialView: ComponentGovernanceView = {
  slots: [
    {
      slotId: 'stageFlow',
      label: 'Stage flow',
      group: 'structural',
      canonicalComponent: 'StageStepper',
      canonicalFilePath: 'src/components/forge/StageStepper.tsx',
      knobSchema: [{ name: 'condensed', type: 'boolean', allowedValues: [true, false], defaultValue: false }],
      consumers: [{ id: 'live', label: 'Live Stage Stepper', filePath: 'src/components/forge/LiveStageStepper.tsx' }],
      deviations: [],
      locked: true,
      knobs: { condensed: false },
    },
    {
      slotId: 'badge',
      label: 'Badge',
      group: 'leaf',
      canonicalComponent: 'Badge',
      canonicalFilePath: 'src/components/ui/badge.tsx',
      knobSchema: [{ name: 'variant', type: 'enum', allowedValues: ['neutral', 'accent'], defaultValue: 'neutral' }],
      consumers: [],
      deviations: [{ id: 'custom', label: 'Custom badge', filePath: 'src/components/forge/journal/StatusBadge.tsx', line: null }],
      locked: true,
      knobs: { variant: 'neutral' },
    },
  ],
};

vi.mock('@/components/governance/governed', () => ({
  Governed: ({ slotId }: { slotId: string }) => <div>Preview:{slotId}</div>,
}));

describe('ComponentsGovernancePanel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(initialView), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders structural slots before leaf slots with preview, consumers, and deviations', () => {
    render(<ComponentsGovernancePanel initialView={initialView} />);
    expect(screen.getByText('Structural')).toBeInTheDocument();
    expect(screen.getByText('Leaf')).toBeInTheDocument();
    expect(screen.getByText('Stage flow')).toBeInTheDocument();
    expect(screen.getAllByText('Badge')).toBeTruthy();
    expect(screen.getByText('Preview:stageFlow')).toBeInTheDocument();
    expect(screen.getByText('Live Stage Stepper')).toBeInTheDocument();
    expect(screen.getByText('Custom badge')).toBeInTheDocument();
  });

  it('sends a lock-only patch (no knobs) when toggling the lock', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<ComponentsGovernancePanel initialView={initialView} />);
    await user.click(screen.getByRole('switch', { name: 'Lock Stage flow' }));
    const lastCall = (fetch as unknown as { mock: { calls: [string, { method?: string; body?: string }][] } }).mock.calls.at(-1)!;
    expect(lastCall[0]).toBe('/api/governance');
    expect(lastCall[1].method).toBe('PUT');
    // locked was true → toggled to false; NO knobs field so unrelated knobs can't be clobbered.
    expect(JSON.parse(lastCall[1].body!)).toEqual({ slots: { stageFlow: { locked: false } } });
  });

  it('sends a single-knob patch when editing one knob', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<ComponentsGovernancePanel initialView={initialView} />);
    await user.click(screen.getByRole('switch', { name: 'Stage flow condensed' }));
    const lastCall = (fetch as unknown as { mock: { calls: [string, { body?: string }][] } }).mock.calls.at(-1)!;
    // Only the changed knob is sent; the server deep-merges it onto the stored state.
    expect(JSON.parse(lastCall[1].body!)).toEqual({ slots: { stageFlow: { locked: true, knobs: { condensed: true } } } });
  });

  it('falls back to a GET refresh when the PUT request rejects', async () => {
    const fetchMock = vi.fn((_url: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') return Promise.reject(new Error('network down'));
      return Promise.resolve(
        new Response(JSON.stringify(initialView), { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<ComponentsGovernancePanel initialView={initialView} />);
    await user.click(screen.getByRole('switch', { name: 'Lock Stage flow' }));
    // The rejected PUT must not surface as an unhandled rejection; it reconciles via GET.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, opts]) => url === '/api/governance' && (!opts || opts.method === undefined)),
      ).toBe(true);
    });
  });
});
