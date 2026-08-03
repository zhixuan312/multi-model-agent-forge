// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
const notFound = vi.fn(() => { throw new Error('NOT_FOUND'); });
const currentMember = vi.fn();
const projectActorFromMember = vi.fn();
const assertProjectReadable = vi.fn();

vi.mock('next/navigation', () => ({ redirect, notFound }));
vi.mock('@/auth/current-member', () => ({ currentMember }));
vi.mock('@/auth/team-scope', () => ({ projectActorFromMember }));
vi.mock('@/projects/projects-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/projects/projects-core')>();
  return { ...actual, assertProjectReadable };
});

const { requireProjectAccess } = await import('@/projects/require-project-access');
const { ProjectAccessError } = await import('@/projects/projects-core');

const ME = { id: 'm1', username: 'ada', displayName: 'Ada', avatarTint: '#111', role: 'member', teamId: 't1' };
const ACTOR = { id: 'm1', teamId: 't1' };

beforeEach(() => {
  vi.clearAllMocks();
  currentMember.mockResolvedValue(ME);
  projectActorFromMember.mockReturnValue(ACTOR);
  assertProjectReadable.mockResolvedValue(undefined);
});

/**
 * This gate was seven byte-identical copies — the six stage pages and the project
 * layout. Seven places to get a security check right, and one place to quietly get it
 * wrong.
 */
describe('requireProjectAccess', () => {
  it('returns the member and actor when everything checks out', async () => {
    await expect(requireProjectAccess('p1')).resolves.toEqual({ me: ME, actor: ACTOR });
    expect(assertProjectReadable).toHaveBeenCalledWith('p1', ACTOR);
  });

  it('sends an unauthenticated visitor to the login page', async () => {
    currentMember.mockResolvedValue(null);
    await expect(requireProjectAccess('p1')).rejects.toThrow('REDIRECT:/login');
    expect(assertProjectReadable).not.toHaveBeenCalled();
  });

  it('sends a member with no project actor home, without touching the project', async () => {
    projectActorFromMember.mockReturnValue(null);
    await expect(requireProjectAccess('p1')).rejects.toThrow('REDIRECT:/');
    expect(assertProjectReadable).not.toHaveBeenCalled();
  });

  /** Never a 403: an unreadable project must look exactly like a missing one. */
  it('answers a project the actor may not see with notFound, not an error', async () => {
    assertProjectReadable.mockRejectedValue(new ProjectAccessError('nope'));
    await expect(requireProjectAccess('p1')).rejects.toThrow('NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('rethrows a genuine failure rather than hiding it as notFound', async () => {
    assertProjectReadable.mockRejectedValue(new Error('db is down'));
    await expect(requireProjectAccess('p1')).rejects.toThrow('db is down');
    expect(notFound).not.toHaveBeenCalled();
  });
});
