// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

// Mock the repos-core so the route test asserts the admin gate + CSRF + verb
// contract without touching the DB or git.
const listRepos = vi.fn(async () => [] as unknown[]);
const cloneAndRegister = vi.fn(async () => ({ kind: 'cloned', repo: { id: 'r1', name: 'x' } }) as never);
const pullExisting = vi.fn(async () => ({ kind: 'pulled', repo: { id: 'r1' } }) as never);
const deleteRepo = vi.fn(async () => ({ kind: 'deleted' }) as never);
vi.mock('@/git/repos-core', () => ({ listRepos, cloneAndRegister, pullExisting, deleteRepo }));

const { GET: reposGET, POST: reposPOST } = await import('../../app/api/repos/route');
const { PUT: repoPUT, DELETE: repoDELETE } = await import('../../app/api/repos/[id]/route');
const { GET: mpGET } = await import('../../app/api/model-profiles/route');

function asAdmin(): AuthedMember {
  return { id: 'a', username: 'admin', displayName: 'A', avatarTint: '#000', role: 'team_admin', teamId: 'team-1' };
}
function asMember(): AuthedMember {
  return { id: 'm', username: 'mem', displayName: 'M', avatarTint: '#000', role: 'member', teamId: 'team-1' };
}

function req(body: unknown, method = 'POST', extraHeaders: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/repos', {
    method,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('repos API route handlers', () => {
  beforeEach(() => {
    mockCaller = null;
    vi.clearAllMocks();
  });

  it('admin gate: non-admin → 403, anon → 401 (GET/POST list+clone)', async () => {
    mockCaller = asMember();
    expect((await reposGET()).status).toBe(403);
    expect((await reposPOST(req({}) as never)).status).toBe(403);
    mockCaller = null;
    expect((await reposGET()).status).toBe(401);
    expect((await reposPOST(req({}) as never)).status).toBe(401);
  });

  it('admin gate: non-admin/anon on [id] PUT/DELETE', async () => {
    const ctx = { params: Promise.resolve({ id: 'r1' }) };
    mockCaller = asMember();
    expect((await repoPUT(req(undefined, 'PUT') as never, ctx)).status).toBe(403);
    expect((await repoDELETE(req(undefined, 'DELETE') as never, ctx)).status).toBe(403);
    mockCaller = null;
    expect((await repoPUT(req(undefined, 'PUT') as never, ctx)).status).toBe(401);
  });

  it('rejects a cross-origin POST even for an admin (CSRF, F12) — no clone runs', async () => {
    mockCaller = asAdmin();
    const res = await reposPOST(
      req({ name: 'x', url: 'u' }, 'POST', { 'sec-fetch-site': 'cross-site' }) as never,
    );
    expect(res.status).toBe(403);
    expect(cloneAndRegister).not.toHaveBeenCalled();
  });

  it('admin same-origin POST → 201 cloned', async () => {
    mockCaller = asAdmin();
    const res = await reposPOST(req({ name: 'core-api', url: 'https://h/r.git', tags: ['core'] }) as never);
    expect(res.status).toBe(201);
    expect(cloneAndRegister).toHaveBeenCalledOnce();
  });

  it('duplicate name → 409; clone error → 502', async () => {
    mockCaller = asAdmin();
    cloneAndRegister.mockResolvedValueOnce({ kind: 'duplicate_name' } as never);
    expect((await reposPOST(req({ name: 'x', url: 'u' }) as never)).status).toBe(409);
    cloneAndRegister.mockResolvedValueOnce({ kind: 'error', message: 'clone failed: auth' } as never);
    expect((await reposPOST(req({ name: 'x', url: 'u' }) as never)).status).toBe(502);
  });

  it('admin GET list → 200', async () => {
    mockCaller = asAdmin();
    expect((await reposGET()).status).toBe(200);
    expect(listRepos).toHaveBeenCalled();
  });

  it('model-profiles route is admin-gated and returns the catalog shape', async () => {
    mockCaller = null;
    expect((await mpGET()).status).toBe(401);
    mockCaller = asAdmin();
    const res = await mpGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; profiles: unknown[] };
    expect(typeof body.available).toBe('boolean');
    expect(Array.isArray(body.profiles)).toBe(true);
  });
});
