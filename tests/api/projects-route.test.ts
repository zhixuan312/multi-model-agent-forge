// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

let mockCaller: AuthedMember | null = null;
const archiveProject = vi.fn();
const unarchiveProject = vi.fn();
const changeVisibility = vi.fn();
const changeRepos = vi.fn();
const assertProjectReadable = vi.fn();
const getProject = vi.fn();
const getProjectRepos = vi.fn();

vi.mock('@/auth/current-member', () => ({ currentMember: async () => mockCaller }));
vi.mock('@/auth/same-origin', () => ({ rejectCrossOrigin: () => null }));
vi.mock('@/projects/projects-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/projects/projects-core')>();
  return {
    ...actual,
    archiveProject,
    unarchiveProject,
    changeVisibility,
    changeRepos,
    assertProjectReadable,
    getProject,
    getProjectRepos,
  };
});

const { ProjectAccessError } = await import('@/projects/projects-core');

const { PATCH } = await import('../../app/api/projects/[id]/route');

const member: AuthedMember = {
  id: 'm1',
  username: 'member',
  displayName: 'Member',
  avatarTint: '#000000',
  role: 'member',
  teamId: 'team-1',
};

function req(body: unknown): Request {
  return new Request('http://localhost/api/projects/p1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'p1' }) };

describe('PATCH /api/projects/[id]', () => {
  beforeEach(() => {
    mockCaller = member;
    archiveProject.mockReset();
    unarchiveProject.mockReset();
    changeVisibility.mockReset();
    changeRepos.mockReset();
    assertProjectReadable.mockReset();
    getProject.mockReset();
    getProjectRepos.mockReset();
    assertProjectReadable.mockResolvedValue(undefined);
    getProject.mockResolvedValue({
      id: 'p1',
      visibility: 'public',
      phase: 'build',
      archived: true,
    });
    getProjectRepos.mockResolvedValue([]);
  });

  it('returns 400 when more than one PATCH branch is provided', async () => {
    const res = await PATCH(req({ archived: true, visibility: 'private' }) as never, ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Provide exactly one of `visibility`, `repoIds`, or `archived`.',
    });
  });

  it('maps unreadable projects to 404 before owner authz', async () => {
    assertProjectReadable.mockRejectedValueOnce(new ProjectAccessError('Project not found.'));
    const res = await PATCH(req({ archived: true }) as never, ctx);
    expect(res.status).toBe(404);
    expect(archiveProject).not.toHaveBeenCalled();
  });

  it('maps readable non-owner archive attempts to 403', async () => {
    archiveProject.mockRejectedValueOnce(new ProjectAccessError('Only the owner may change archive state.'));
    const res = await PATCH(req({ archived: true }) as never, ctx);
    expect(res.status).toBe(403);
  });

  it('archives on { archived: true } and returns the archive fields', async () => {
    archiveProject.mockResolvedValueOnce({ archived: true });
    const res = await PATCH(req({ archived: true }) as never, ctx);
    expect(res.status).toBe(200);
    expect(archiveProject).toHaveBeenCalledWith('p1', { id: 'm1', teamId: 'team-1' });
    expect(await res.json()).toEqual({
      id: 'p1',
      archived: true,
      visibility: 'public',
      phase: 'build',
    });
  });

  it('unarchives on { archived: false } and returns archived=false', async () => {
    getProject.mockResolvedValueOnce({
      id: 'p1',
      visibility: 'public',
      phase: 'build',
      archived: false,
    });
    const res = await PATCH(req({ archived: false }) as never, ctx);
    expect(res.status).toBe(200);
    expect(unarchiveProject).toHaveBeenCalledWith('p1', { id: 'm1', teamId: 'team-1' });
    expect(await res.json()).toEqual({
      id: 'p1',
      archived: false,
      visibility: 'public',
      phase: 'build',
    });
  });
});
