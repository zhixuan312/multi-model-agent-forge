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

describe('connections API route — team gate', () => {
  beforeEach(() => {
    mockCaller = null;
  });

  it('unauthenticated → 401 (GET + PUT)', async () => {
    mockCaller = null;
    expect((await connGET()).status).toBe(401);
    expect((await connPUT(putReq({}) as never)).status).toBe(401);
  });

  it('member without teamId → 401 (GET + PUT)', async () => {
    mockCaller = { id: 'm-x', username: 'mem', displayName: 'Member', avatarTint: '#9a6b4f', role: 'org_admin', teamId: null };
    expect((await connGET()).status).toBe(401);
    expect((await connPUT(putReq({}) as never)).status).toBe(401);
  });
});
