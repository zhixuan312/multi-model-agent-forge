// @vitest-environment node
import { vi } from 'vitest';
import { getDb } from '@/db/client';
import { teamSettings } from '@/db/schema/config';
import type { AuthedMember } from '@/auth/auth-provider';
import { cleanupConfig } from '../config/config-fixtures';

const hasDb = !!process.env.DATABASE_URL;

// Drive the handlers as admin / member / anon without minting cookies.
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

function asAdmin(): AuthedMember {
  return { id: 'admin-x', username: 'admin', displayName: 'Admin', avatarTint: '#9a6b4f', isAdmin: true };
}
function asMember(): AuthedMember {
  return { id: 'm-x', username: 'mem', displayName: 'Member', avatarTint: '#9a6b4f', isAdmin: false };
}

// Import handlers AFTER the mock is registered. Providers + roster routes were
// removed when the Models tab took over; connections is the remaining config route.
const { GET: connGET, PUT: connPUT } = await import('../../app/api/connections/route');

function jsonReq(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasDb)('connections API route handlers (admin gate + verb contract)', () => {
  const db = getDb();

  beforeEach(() => {
    mockCaller = null;
  });

  afterAll(async () => {
    await cleanupConfig();
  });

  it('non-admin → 403, unauthenticated → 401 (connections GET/PUT)', async () => {
    mockCaller = asMember();
    expect((await connGET()).status).toBe(403);
    expect((await connPUT(jsonReq({}, 'PUT') as never)).status).toBe(403);
    mockCaller = null;
    expect((await connGET()).status).toBe(401);
    expect((await connPUT(jsonReq({}, 'PUT') as never)).status).toBe(401);
  });

  it('PUT stores token refs (never plaintext); GET shows set booleans only', async () => {
    mockCaller = asAdmin();
    await db.delete(teamSettings);
    const res = await connPUT(
      jsonReq(
        { mmaBaseUrl: 'http://127.0.0.1:7337', mmaToken: 'mma_ROUTE_TOK', gitToken: 'ghs_ROUTE_TOK' },
        'PUT',
      ) as never,
    );
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.mmaTokenSet).toBe(true);
    expect(view.gitTokenSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('mma_ROUTE_TOK');
    expect(JSON.stringify(view)).not.toContain('ghs_ROUTE_TOK');

    // The DB row holds refs, not the plaintext tokens.
    const [row] = await db.select().from(teamSettings).limit(1);
    expect(JSON.stringify(row)).not.toContain('mma_ROUTE_TOK');
    expect(JSON.stringify(row)).not.toContain('ghs_ROUTE_TOK');

    const getView = await (await connGET()).json();
    expect(getView.mmaBaseUrl).toBe('http://127.0.0.1:7337');
  });
});
