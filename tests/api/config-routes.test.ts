// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// Admin-gate contract for the Connections route. The gate (403 non-admin / 401
// anon) short-circuits BEFORE any DB access, so it is verified DB-free. The
// authenticated read/write path persists to Postgres in production only — tests
// never touch a database (see tests/setup.ts).
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

// Import handlers AFTER the mock is registered.
const { GET: connGET, PUT: connPUT } = await import('../../app/api/connections/route');

function putReq(body: unknown): Request {
  return new Request('http://localhost/api/connections', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('connections API route — scope gates (org-owned vs team-owned)', () => {
  beforeEach(() => {
    mockCaller = null;
  });

  it('unauthenticated → 401 (GET + PUT)', async () => {
    mockCaller = null;
    expect((await connGET()).status).toBe(401);
    expect((await connPUT(putReq({}) as never)).status).toBe(401);
  });

  it('a team admin CANNOT set the org-owned speech-to-text key → 403', async () => {
    mockCaller = { id: 'ta', username: 'ta', displayName: 'TA', avatarTint: '#000', role: 'team_admin', teamId: 't1' };
    expect((await connPUT(putReq({ openaiTranscriptionKey: 'sk_x' }) as never)).status).toBe(403);
  });

  it('a team admin CANNOT set the org-owned MMA base URL → 403', async () => {
    mockCaller = { id: 'ta', username: 'ta', displayName: 'TA', avatarTint: '#000', role: 'team_admin', teamId: 't1' };
    expect((await connPUT(putReq({ mmaBaseUrl: 'http://x' }) as never)).status).toBe(403);
  });

  it('a member with no team CANNOT set the team git token → 403', async () => {
    mockCaller = { id: 'oa', username: 'oa', displayName: 'OA', avatarTint: '#000', role: 'org_admin', teamId: null };
    expect((await connPUT(putReq({ gitToken: 'ghs_x' }) as never)).status).toBe(403);
  });

  it('a plain member (with a team) CANNOT set the team git token → 403', async () => {
    // The git token is a team-owned secret; only a team_admin may rotate it. A
    // teamId alone (any member) must not be enough — this is the gate the route
    // previously left open.
    mockCaller = { id: 'm', username: 'm', displayName: 'M', avatarTint: '#000', role: 'member', teamId: 't1' };
    expect((await connPUT(putReq({ gitToken: 'ghs_x' }) as never)).status).toBe(403);
  });
});
