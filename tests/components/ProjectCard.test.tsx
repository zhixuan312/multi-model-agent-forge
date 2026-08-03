import { render, screen, within } from '@testing-library/react';
import { STAGE_KIND } from '@/db/enums';
import { ProjectCard } from '@/components/forge/ProjectCard';
import type { DashboardProject } from '@/dashboard/dashboard-core';

function item(over: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: 'p1',
    name: 'Payments refund flow',
    summary: 'Self-serve partial refunds with an approval threshold.',
    visibility: 'public',
    phase: 'build',
    currentStage: 'plan',
    ownerId: 'o1',
    ownerDisplayName: 'Devon Vance',
    ownerAvatarTint: '#5E7C6B',
    updatedAt: new Date(),
    isMember: false,
    stages: [
      { kind: 'exploration', status: 'done' },
      { kind: 'spec', status: 'done' },
      { kind: 'plan', status: 'active' },
      { kind: 'execute', status: 'pending' },
      { kind: 'review', status: 'pending' },
    ],
    repoCount: 6,
    unavailableRepoCount: 0,
    archived: false,
    awaitingHuman: 0,
    auditsNeedingFix: 0,
    agentsRunning: 0,
    latestArtifact: null,
    collaborators: [],
    nextAction: { label: 'Build running', tone: 'info' },
    ...over,
  };
}

describe('ProjectCard', () => {
  it('renders serif title, phase badge, visibility chip, owner footer', () => {
    render(<ProjectCard project={item()} />);
    expect(screen.getByText('Payments refund flow')).toBeInTheDocument();
    expect(screen.getByTestId('phase-badge')).toHaveTextContent('Build');
    expect(screen.getByTestId('visibility-chip')).toHaveTextContent('public');
    expect(screen.getByText('Devon Vance')).toBeInTheDocument();
  });

  it('renders the summary when present, a neutral placeholder when NULL (not blank)', () => {
    const { rerender } = render(<ProjectCard project={item()} />);
    expect(screen.getByText('Self-serve partial refunds with an approval threshold.')).toBeInTheDocument();

    rerender(<ProjectCard project={item({ summary: null })} />);
    expect(screen.getByText(/No summary yet/i)).toBeInTheDocument();
  });

  /**
   * The segment label is the segment's ACCESSIBLE NAME, so it must be the name a person is
   * shown. Two kinds differ: `exploration` is Explore and `journal` is Reflect — and there is
   * also a team-level /journal, so the key reads as a different feature entirely.
   *
   * This test asserted `'exploration: done'`, pinning the raw key it was passing through.
   */
  it('stage rail names each stage as the user sees it, not by its enum key', () => {
    const { container } = render(<ProjectCard project={item()} />);
    const rail = container.querySelector('[aria-label="Stage progress"]')!;
    const segs = within(rail as HTMLElement).getAllByRole('listitem');
    expect(segs).toHaveLength(5);
    expect(segs[0]).toHaveAttribute('aria-label', 'Explore: done');
    expect(segs[2]).toHaveAttribute('aria-label', 'Plan: active');
    expect(segs[3]).toHaveAttribute('aria-label', 'Execute: pending');

    // And nothing in the rail announces a stage by its enum key.
    const names = segs.map((s) => s.getAttribute('aria-label') ?? '');
    for (const key of STAGE_KIND) {
      expect(names.some((n) => n.startsWith(`${key}:`)), `"${key}" is announced by its key`).toBe(false);
    }
  });

  it('shows the repo-unavailable chip when there are unavailable repos', () => {
    render(<ProjectCard project={item({ unavailableRepoCount: 2, repoCount: 4 })} />);
    expect(screen.getByTestId('repo-unavailable-chip')).toBeInTheDocument();
    expect(screen.getByText(/4 repos/)).toBeInTheDocument();
  });

  it('hides the chip when all repos resolve', () => {
    render(<ProjectCard project={item()} />);
    expect(screen.queryByTestId('repo-unavailable-chip')).not.toBeInTheDocument();
  });
});
