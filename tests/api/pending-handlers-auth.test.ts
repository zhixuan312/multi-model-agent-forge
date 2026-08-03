// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// The pending-handlers GET mutates state (fails stale batches, pushes notifications, publishes
// to the project bus) yet previously had NO authentication — any cookie-bearing request could
// force-fail any project's batches. The auth gate short-circuits BEFORE any DB access, so it is
// verified DB-free (tests never touch a database — see tests/setup.ts).
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

const { GET } = await import('../../app/api/projects/[id]/pending-handlers/route');

/**
 * A `NextRequest` shape, not a bare `Request`: this GET mutates, so it takes the CSRF
 * step, and `rejectCrossOrigin` reads headers off the request. With no `Origin` and no
 * `Sec-Fetch-Site` the guard allows it — its documented fallback — so these cases still
 * exercise the AUTH gate, which is what they are about.
 */
function call(id = 'proj-1') {
  const req = new Request('http://localhost/api/projects/proj-1/pending-handlers') as never;
  return GET(req, { params: Promise.resolve({ id }) });
}

describe('GET /api/projects/[id]/pending-handlers — auth gate', () => {
  beforeEach(() => {
    mockCaller = null;
  });

  it('unauthenticated → 401', async () => {
    mockCaller = null;
    expect((await call()).status).toBe(401);
  });

  it('authenticated but with no team → 401 (cannot form a project actor)', async () => {
    mockCaller = { id: 'oa', username: 'oa', displayName: 'OA', avatarTint: '#000', role: 'org_admin', teamId: null };
    expect((await call()).status).toBe(401);
  });

  /**
   * This route alone answered an unreadable project with 403, telling an authenticated
   * cross-team probe that the id exists — exactly what its sibling GETs' 404 hides.
   */
  it('rejects a cross-origin request before doing any work', async () => {
    mockCaller = { id: 'm1', username: 'm', displayName: 'M', avatarTint: '#000', role: 'member', teamId: 't1' };
    const req = new Request('http://localhost/api/projects/proj-1/pending-handlers', {
      headers: { 'sec-fetch-site': 'cross-site' },
    }) as never;
    const res = await GET(req, { params: Promise.resolve({ id: 'proj-1' }) });
    expect(res.status).toBe(403);
  });
});
