import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecuteStageClient, type RepoTerminalResult } from '@/components/forge/ExecuteStageClient';
import type { RepoGroup } from '@/build/execute-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/projects/p1/execute',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/useMmaDispatch', () => ({
  useMmaDispatch: () => ({
    transition: vi.fn(async () => {}),
    dispatch: vi.fn(),
    waitFor: vi.fn(async () => {}),
    busyHandlers: new Set<string>(),
    busyRef: { current: new Set<string>() },
  }),
}));

const group = (over: Partial<RepoGroup> = {}): RepoGroup => ({
  repoId: 'r1',
  repoName: 'engine',
  pathOnDisk: '/tmp/engine',
  defaultBranch: 'main',
  targetBranch: 'main',
  forgeBranch: 'mma/demo',
  branches: ['main'],
  tasks: [{ id: 't1', title: 'Do the thing', orderIndex: 0, targetRepoId: 'r1', status: 'committed', phase: null, branch: 'mma/demo', commitSha: 'abc', repoName: 'engine', repoPath: '/tmp/engine', defaultBranch: 'main' }],
  ...over,
} as RepoGroup);

const terminal = (over: Partial<RepoTerminalResult>): Record<string, RepoTerminalResult> => ({
  r1: { status: 'done', durationMs: 1000, costUsd: 0.5, filesChanged: ['a.ts'], error: null, ...over },
});

function renderStage(opts: {
  terminalResults?: Record<string, RepoTerminalResult>;
  buildPrs?: Record<string, { url: string; branch: string; targetBranch: string }>;
}) {
  return render(
    <ExecuteStageClient
      projectId="p1"
      projectName="Demo"
      repoGroups={[group()]}
      buildPrs={opts.buildPrs ?? {}}
      terminalResults={opts.terminalResults}
      initialPhase="implement"
    />,
  );
}

describe('ExecuteStageClient — what a finished repo claims', () => {
  /**
   * The done-state pills rendered a green "✓ PR" unconditionally. A repo with no writable
   * remote finishes with no pull request — the summary line right below already handles that
   * by omitting the link — and this told the user one had been opened.
   */
  it('does not claim a PR when none was opened', () => {
    renderStage({ terminalResults: terminal({}) });
    expect(screen.queryByText('✓ PR')).toBeNull();
    expect(screen.getByText('No PR')).toBeInTheDocument();
  });

  it('claims the PR when there is one', () => {
    renderStage({
      terminalResults: terminal({}),
      buildPrs: { r1: { url: 'https://example.test/pr/1', branch: 'mma/demo', targetBranch: 'main' } },
    });
    expect(screen.getByText('✓ PR')).toBeInTheDocument();
    expect(screen.queryByText('No PR')).toBeNull();
  });
});

describe('ExecuteStageClient — what a failed repo says', () => {
  /**
   * Every failure read "Execution failed": a provider 401, a sandbox denial and a build error
   * were indistinguishable, while the envelope carrying the engine's own message was already
   * on the batch row.
   */
  it('shows the engine’s reason', () => {
    renderStage({ terminalResults: terminal({ status: 'failed', error: 'provider returned 401' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('provider returned 401');
  });

  it('falls back to a generic line when the envelope carried no message', () => {
    renderStage({ terminalResults: terminal({ status: 'failed', error: null }) });
    expect(screen.getByRole('alert')).toHaveTextContent('Execution failed');
  });
});
