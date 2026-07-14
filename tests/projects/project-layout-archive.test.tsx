import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const currentMember = vi.fn();
const assertProjectReadable = vi.fn();
const getProject = vi.fn();
const getProjectStages = vi.fn();
const getStagePermissions = vi.fn();
const ProjectTopbar = vi.fn(() => <div data-testid="project-topbar-probe" />);

vi.mock('@/auth/current-member', () => ({ currentMember }));
vi.mock('@/auth/team-scope', () => ({
  projectActorFromMember: (member: { id: string; teamId: string | null }) =>
    member.teamId ? { id: member.id, teamId: member.teamId } : null,
}));
vi.mock('@/projects/projects-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/projects/projects-core')>();
  return {
    ...actual,
    assertProjectReadable,
    getProject,
    getProjectStages,
  };
});
vi.mock('@/projects/stage-gate', () => ({ getStagePermissions }));
vi.mock('@/components/forge/ProjectTopbar', () => ({ ProjectTopbar }));
vi.mock('@/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve([]),
        }),
      }),
    }),
  }),
}));

const { default: ProjectLayout } = await import('../../app/(app)/projects/[id]/layout');

describe('project layout archive wiring', () => {
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
    assertProjectReadable.mockResolvedValue(undefined);
    getProject.mockResolvedValue({
      id: 'proj-1',
      name: 'Archived demo',
      ownerId: 'owner-1',
      phase: 'build',
      currentStage: 'execute',
      autoMode: false,
      autoNote: null,
      archived: true,
      details: null,
    });
    getProjectStages.mockResolvedValue([{ kind: 'execute', status: 'active', lastPhase: 'build' }]);
    getStagePermissions.mockResolvedValue({
      explore: { canMutate: true },
      spec: { canMutate: true },
      plan: { canMutate: true },
      execute: { canMutate: true },
      review: { canMutate: true },
      journal: { canMutate: true },
    });
  });

  it('passes owner-gated archive props into ProjectTopbar', async () => {
    const ui = await ProjectLayout({
      children: <div>child</div>,
      params: Promise.resolve({ id: 'proj-1' }),
    });

    render(ui);
    expect(screen.getByTestId('project-topbar-probe')).toBeInTheDocument();
    expect(ProjectTopbar).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        projectName: 'Archived demo',
        canArchive: true,
        archived: true,
      }),
      undefined,
    );
  });
});
