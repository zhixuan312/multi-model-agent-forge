import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExploreStageClient } from '@/components/forge/ExploreStageClient';
import type { RailTask } from '@/hooks/useProjectEvents';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p1/explore',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/useProjectEvents', async (orig) => ({
  ...(await (orig() as Promise<object>)),
  useProjectEvents: () => {},
}));

const transition = vi.fn(async () => {});
vi.mock('@/hooks/useMmaDispatch', () => ({
  useMmaDispatch: () => ({
    transition, dispatch: vi.fn(), waitFor: vi.fn(async () => {}),
    busyHandlers: new Set<string>(), busyRef: { current: new Set<string>() }, error: null,
  }),
}));

const task = (id: string): RailTask => ({
  id, kind: 'research', prompt: 'What is prior art here?', status: 'recorded',
  batchStatus: 'done', outputMd: '# Findings', targetRepoId: null, headline: null, error: null,
  mmaBatchId: null,
});

/**
 * The synthesize view's empty body has three states, and its own comment said so: running,
 * failed, idle. Only the first two were written — anything that was not the error fell
 * through to the spinner. The stage auto-fires a synthesis on entry UNLESS the viewer is
 * read-only, so a member on a frozen stage watched "Synthesizing exploration findings into a
 * brief..." indefinitely for a run that was never started.
 */
describe('exploration synthesis — the empty summary pane', () => {
  const base = {
    projectId: 'p1',
    projectName: 'Demo',
    initialBrief: 'A brief.',
    initialTasks: [task('t1')],
    initialArtifact: null,
    repoOptions: [],
    voiceEnabled: false,
    initialPhase: 'synthesize' as const,
  };

  it('does not claim to be synthesizing for a read-only viewer', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ExploreStageClient {...base} readOnly lockedReason="Build has started." />
      </QueryClientProvider>,
    );

    expect(screen.queryByText(/Synthesizing exploration findings/)).toBeNull();
    expect(screen.getByText('No brief yet')).toBeInTheDocument();
    expect(screen.getByText(/read-only for you/)).toBeInTheDocument();
    // And it must not have quietly dispatched one on their behalf.
    expect(transition).not.toHaveBeenCalledWith('dispatch_synthesize', undefined, 'explore-synthesize');
  });
});
