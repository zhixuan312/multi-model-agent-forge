import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AutomationOverlay } from '@/components/forge/AutomationOverlay';
import { SummaryPhase } from '@/components/forge/SummaryPhase';

class FakeEventSource {
  constructor(_url: string) {}
  close(): void {}
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('project activity rendering', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const events = [{
    id: 'a1',
    seq: 1,
    stage: 'spec',
    phase: 'craft',
    label: 'Drafted spec',
    kind: 'done' as const,
    actorName: 'Avery',
    actorTint: '#09f',
    source: 'mma' as const,
    durationMs: 1200,
    eventKey: 'spec-auto-draft:batch-1',
    createdAt: '2026-07-10T00:00:00.000Z',
  }];

  it('shows actor name, label, and duration from the mapped event shape', () => {
    wrap(
      <SummaryPhase
        projectId="proj-1"
        summary={{
          projectName: 'Demo',
          createdAt: new Date('2026-06-01'),
          completedAt: null,
          timeline: { stages: [] },
          cost: { totalUsd: 0, savedUsd: 0 },
          effort: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalDurationMs: 0 },
          quality: { auditPasses: [], specVersion: 0, planVersion: 0 },
          delivery: { totalTasks: 0, approved: 0 },
          knowledge: { recorded: 0, byType: {} },
          events,
        }}
      />,
    );
    expect(screen.getByText('Avery')).toBeInTheDocument();
    expect(screen.getByText('Drafted spec')).toBeInTheDocument();
    expect(screen.getByText('1.2s')).toBeInTheDocument();
  });

  it('renders AutomationOverlay from the same project activity event shape', () => {
    wrap(
      <AutomationOverlay
        projectId="proj-1"
        projectName="Demo"
        autoMode
        autoNote=""
        currentStage="spec"
        phase="active"
        stagePhase="craft"
        events={events}
      />,
    );

    expect(screen.getByText('Avery')).toBeInTheDocument();
    expect(screen.getByText('Drafted spec')).toBeInTheDocument();
    expect(screen.getByText('1.2s')).toBeInTheDocument();
  });
});
