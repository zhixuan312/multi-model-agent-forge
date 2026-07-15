import { render, screen } from '@testing-library/react';
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

  it('submits lock and knob updates through the /api/governance route', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<ComponentsGovernancePanel initialView={initialView} />);
    await user.click(screen.getByRole('switch', { name: 'Lock Stage flow' }));
    expect(fetch).toHaveBeenCalledWith('/api/governance', expect.objectContaining({ method: 'PUT' }));
  });
});
