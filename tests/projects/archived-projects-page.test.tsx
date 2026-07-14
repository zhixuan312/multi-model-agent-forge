import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const currentMember = vi.fn();
const archivedProjects = vi.fn();

vi.mock('@/auth/current-member', () => ({ currentMember }));
vi.mock('@/auth/team-scope', () => ({
  projectActorFromMember: (member: { id: string; teamId: string | null }) =>
    member.teamId ? { id: member.id, teamId: member.teamId } : null,
}));
vi.mock('@/projects/projects-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/projects/projects-core')>();
  return {
    ...actual,
    archivedProjects,
  };
});
vi.mock('@/components/forge/ProjectArchiveButton', () => ({
  ProjectArchiveButton: ({ projectId }: { projectId: string }) => <button type="button">Unarchive {projectId}</button>,
}));

const { default: ArchivedProjectsPage } = await import('../../app/(app)/projects/archived/page');

describe('archived projects page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMember.mockResolvedValue({
      id: 'owner-1',
      username: 'owner',
      displayName: 'Owner',
      avatarTint: '#000',
      role: 'member',
      teamId: 'team-1',
    });
  });

  it('renders a distinct empty state when no archived rows exist', async () => {
    archivedProjects.mockResolvedValue([]);
    const ui = await ArchivedProjectsPage();
    render(ui);
    expect(screen.getByText('No archived projects')).toBeInTheDocument();
    expect(screen.getByText(/Archived projects you restore will return to the active Projects list/i)).toBeInTheDocument();
  });

  it('renders archived rows with unarchive controls', async () => {
    archivedProjects.mockResolvedValue([
      {
        id: 'proj-1',
        name: 'Archived one',
        summary: 'A paused project',
        visibility: 'public',
        phase: 'build',
        currentStage: 'execute',
        ownerId: 'owner-1',
        ownerDisplayName: 'Owner',
        ownerAvatarTint: '#000',
        updatedAt: new Date('2026-07-14T08:00:00.000Z'),
        archivedAt: new Date('2026-07-14T09:00:00.000Z'),
        isMember: true,
        stages: [],
        repoCount: 1,
        unavailableRepoCount: 0,
      },
    ]);

    const ui = await ArchivedProjectsPage();
    render(ui);
    expect(screen.getByText('Archived one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unarchive proj-1' })).toBeInTheDocument();
  });

  it('does not render an unarchive control for an archived project the actor does not own', async () => {
    archivedProjects.mockResolvedValue([
      {
        id: 'proj-2',
        name: 'Someone elses archived',
        summary: 'Public, not mine',
        visibility: 'public',
        phase: 'build',
        currentStage: 'execute',
        ownerId: 'owner-2',
        ownerDisplayName: 'Other',
        ownerAvatarTint: '#111',
        updatedAt: new Date('2026-07-14T08:00:00.000Z'),
        archivedAt: new Date('2026-07-14T09:00:00.000Z'),
        isMember: false,
        stages: [],
        repoCount: 1,
        unavailableRepoCount: 0,
      },
    ]);
    const ui = await ArchivedProjectsPage();
    render(ui);
    expect(screen.getByText('Someone elses archived')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unarchive proj-2' })).not.toBeInTheDocument();
  });
});
