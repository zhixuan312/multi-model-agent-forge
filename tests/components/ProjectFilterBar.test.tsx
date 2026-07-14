import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectFilterBar, filterProjects } from '@/components/forge/ProjectFilterBar';
import type { DashboardProject } from '@/dashboard/dashboard-core';

function item(over: Partial<DashboardProject>): DashboardProject {
  return {
    id: over.id ?? 'p',
    name: over.name ?? 'Project',
    summary: over.summary ?? null,
    visibility: 'public',
    phase: over.phase ?? 'design',
    currentStage: 'exploration',
    ownerId: 'o1',
    ownerDisplayName: 'Owner',
    ownerAvatarTint: '#000',
    updatedAt: new Date(),
    isMember: over.isMember ?? false,
    stages: [
      { kind: 'exploration', status: 'active' },
      { kind: 'spec', status: 'pending' },
      { kind: 'plan', status: 'pending' },
      { kind: 'execute', status: 'pending' },
      { kind: 'review', status: 'pending' },
    ],
    repoCount: 1,
    unavailableRepoCount: 0,
    archived: over.archived ?? false,
    awaitingHuman: 0,
    openAuditIssues: 0,
    agentsRunning: 0,
    latestArtifact: null,
    collaborators: [],
    nextAction: { label: 'Continue exploration', tone: 'normal' },
    ...over,
  };
}

const projects: DashboardProject[] = [
  item({ id: 'a', name: 'Foo Bar', phase: 'design', isMember: true }),
  item({ id: 'b', name: 'Payments', summary: 'refund flow', phase: 'build', isMember: false }),
  item({ id: 'c', name: 'Reranker', phase: 'learn', isMember: false }),
  item({ id: 'd', name: 'Another design', phase: 'design', isMember: false }),
];

const archived: DashboardProject[] = [
  item({ id: 'z', name: 'Retired thing', phase: 'completed', isMember: true }),
];

describe('filterProjects (pure)', () => {
  it('search is case-insensitive trimmed substring over name + summary', () => {
    expect(filterProjects(projects, { search: '  FOO ', needsAction: false, mine: false }).map((p) => p.id)).toEqual(['a']);
    // summary match
    expect(filterProjects(projects, { search: 'refund', needsAction: false, mine: false }).map((p) => p.id)).toEqual(['b']);
    // whitespace-only matches all
    expect(filterProjects(projects, { search: '   ', needsAction: false, mine: false })).toHaveLength(4);
  });

  it('null summary only matches on name', () => {
    // 'reranker' has null summary; searching its name matches, a non-name term does not
    expect(filterProjects(projects, { search: 'rerank', needsAction: false, mine: false }).map((p) => p.id)).toEqual(['c']);
  });

  it('needsAction keeps only projects blocked on a human gate or open audit issue', () => {
    const blocked = item({ id: 'e', name: 'Blocked', awaitingHuman: 2 });
    expect(filterProjects([...projects, blocked], { search: '', needsAction: true, mine: false }).map((p) => p.id)).toEqual(['e']);
  });

  it('mine filters to owner-or-collaborator; all team shows the full set', () => {
    expect(filterProjects(projects, { search: '', needsAction: false, mine: true }).map((p) => p.id)).toEqual(['a']);
    expect(filterProjects(projects, { search: '', needsAction: false, mine: false })).toHaveLength(4);
  });
});

describe('ProjectFilterBar (component)', () => {
  it('renders keyboard-operable, labelled controls exposing pressed state', () => {
    render(<ProjectFilterBar activeProjects={projects} archivedProjects={archived} />);
    expect(screen.getByLabelText('Search projects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active 4' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Archived 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'All team' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('has no phase chips (phase filtering was removed)', () => {
    render(<ProjectFilterBar activeProjects={projects} archivedProjects={archived} />);
    for (const label of ['All 4', 'Design', 'Build', 'Learn', 'Completed']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('search narrows the rendered grid', () => {
    render(<ProjectFilterBar activeProjects={projects} archivedProjects={archived} />);
    expect(screen.getAllByTestId(/project-card-/)).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'foo' } });
    expect(screen.getAllByTestId(/project-card-/)).toHaveLength(1);
    expect(screen.getByText('Foo Bar')).toBeInTheDocument();
  });

  it('Active|Archived toggle swaps the rendered set and pressed state', () => {
    render(<ProjectFilterBar activeProjects={projects} archivedProjects={archived} />);
    // default: active set
    expect(screen.getAllByTestId(/project-card-/)).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Archived 1' }));
    expect(screen.getByRole('button', { name: 'Archived 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Active 4' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByTestId(/project-card-/)).toHaveLength(1);
    expect(screen.getByText('Retired thing')).toBeInTheDocument();
  });
});
