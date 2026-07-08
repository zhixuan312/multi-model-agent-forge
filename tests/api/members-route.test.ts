// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// Admin-gate contract for the Members routes. The gate (403 non-admin / 401 anon)
// short-circuits BEFORE any DB access, so it is verified DB-free. The
// authenticated create/patch/reset/delete paths persist to Postgres in
// production only — tests never touch a database (see tests/setup.ts).
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

function asMember(): AuthedMember {
  return { id: 'm-x', username: 'mem', displayName: 'Member', avatarTint: '#9a6b4f', role: 'member', teamId: 'team-1' };
}

// Import handlers AFTER the mock is registered.
const { POST: createPOST } = await import('../../app/api/members/route');
const { PATCH, DELETE } = await import('../../app/api/members/[id]/route');
const { POST: resetPOST } = await import('../../app/api/members/[id]/password/route');

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/api/members', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('Members API routes — admin gate', () => {
  beforeEach(() => {
    mockCaller = null;
  });

  it('non-admin → 403 across create / patch / reset / delete', async () => {
    mockCaller = asMember();
    expect((await createPOST(jsonReq({ displayName: 'X', username: 'x', password: 'a-strong-password' }) as never)).status).toBe(403);
    expect((await PATCH(jsonReq({ isAdmin: true }) as never, params('id') as never)).status).toBe(403);
    expect((await resetPOST(jsonReq({ newPassword: 'a-strong-password' }) as never, params('id') as never)).status).toBe(403);
    expect((await DELETE(jsonReq({}) as never, params('id') as never)).status).toBe(403);
  });

  it('unauthenticated → 401 on create', async () => {
    mockCaller = null;
    expect((await createPOST(jsonReq({ displayName: 'X', username: 'x', password: 'a-strong-password' }) as never)).status).toBe(401);
  });
});
