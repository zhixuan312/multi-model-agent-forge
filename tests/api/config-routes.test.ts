// @vitest-environment node
import { vi } from 'vitest';
import { getDb } from '@/db/client';
import { teamSettings } from '@/db/schema/config';
import type { AuthedMember } from '@/auth/auth-provider';
import { cleanupConfig, uniqueName, seedTestProvider } from '../config/config-fixtures';

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

// Import handlers AFTER the mock is registered.
const { GET: providersGET, POST: providersPOST } = await import('../../app/api/providers/route');
const { PATCH: providerPATCH, DELETE: providerDELETE } = await import(
  '../../app/api/providers/[id]/route'
);
const { GET: rosterGET, PUT: rosterPUT } = await import('../../app/api/roster/route');
const { GET: connGET, PUT: connPUT } = await import('../../app/api/connections/route');

function jsonReq(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!hasDb)('config API route handlers (admin gate + verb contract)', () => {
  const db = getDb();

  beforeEach(() => {
    mockCaller = null;
  });

  afterAll(async () => {
    await cleanupConfig();
  });

  describe('admin gate on every route', () => {
    it('non-admin → 403, unauthenticated → 401 (providers GET/POST)', async () => {
      mockCaller = asMember();
      expect((await providersGET()).status).toBe(403);
      expect((await providersPOST(jsonReq({}) as never)).status).toBe(403);
      mockCaller = null;
      expect((await providersGET()).status).toBe(401);
      expect((await providersPOST(jsonReq({}) as never)).status).toBe(401);
    });

    it('non-admin/anon → 403/401 (provider [id] PATCH/DELETE)', async () => {
      const ctx = { params: Promise.resolve({ id: 'x' }) };
      mockCaller = asMember();
      expect((await providerPATCH(jsonReq({}, 'PATCH') as never, ctx)).status).toBe(403);
      expect((await providerDELETE(jsonReq({}, 'DELETE') as never, ctx)).status).toBe(403);
      mockCaller = null;
      expect((await providerPATCH(jsonReq({}, 'PATCH') as never, ctx)).status).toBe(401);
      expect((await providerDELETE(jsonReq({}, 'DELETE') as never, ctx)).status).toBe(401);
    });

    it('non-admin/anon → 403/401 (roster GET/PUT)', async () => {
      mockCaller = asMember();
      expect((await rosterGET()).status).toBe(403);
      expect((await rosterPUT(jsonReq({ tiers: [] }, 'PUT') as never)).status).toBe(403);
      mockCaller = null;
      expect((await rosterGET()).status).toBe(401);
      expect((await rosterPUT(jsonReq({ tiers: [] }, 'PUT') as never)).status).toBe(401);
    });

    it('non-admin/anon → 403/401 (connections GET/PUT)', async () => {
      mockCaller = asMember();
      expect((await connGET()).status).toBe(403);
      expect((await connPUT(jsonReq({}, 'PUT') as never)).status).toBe(403);
      mockCaller = null;
      expect((await connGET()).status).toBe(401);
      expect((await connPUT(jsonReq({}, 'PUT') as never)).status).toBe(401);
    });
  });

  describe('providers verb contract', () => {
    it('admin create → 201, key never echoed; GET lists it', async () => {
      mockCaller = asAdmin();
      const name = uniqueName('route');
      const res = await providersPOST(
        jsonReq({ name, type: 'codex', apiKey: 'sk-ROUTE-SECRET' }) as never,
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe(name);
      expect(body.apiKeySet).toBe(true);
      expect(JSON.stringify(body)).not.toContain('sk-ROUTE-SECRET');

      const listRes = await providersGET();
      const list = await listRes.json();
      expect(JSON.stringify(list)).not.toContain('sk-ROUTE-SECRET');
      expect(list.some((p: { name: string }) => p.name === name)).toBe(true);
    });

    it('duplicate name → 409; bad type → 400', async () => {
      mockCaller = asAdmin();
      const name = uniqueName('rdup');
      await providersPOST(jsonReq({ name, type: 'claude' }) as never);
      expect((await providersPOST(jsonReq({ name, type: 'claude' }) as never)).status).toBe(409);
      expect(
        (await providersPOST(jsonReq({ name: uniqueName('rbad'), type: 'gpt' }) as never)).status,
      ).toBe(400);
    });

    it('PATCH updates, DELETE removes', async () => {
      mockCaller = asAdmin();
      const created = await (
        await providersPOST(jsonReq({ name: uniqueName('rpatch'), type: 'claude' }) as never)
      ).json();
      const ctx = { params: Promise.resolve({ id: created.id }) };

      const newName = uniqueName('rpatched');
      const patchRes = await providerPATCH(jsonReq({ name: newName }, 'PATCH') as never, ctx);
      expect(patchRes.status).toBe(200);
      expect((await patchRes.json()).name).toBe(newName);

      expect((await providerDELETE(jsonReq({}, 'DELETE') as never, ctx)).status).toBe(204);
    });
  });

  describe('roster verb contract', () => {
    it('GET returns 3 tiers; PUT updates by tier', async () => {
      mockCaller = asAdmin();
      const list = await (await rosterGET()).json();
      expect(list.map((r: { tier: string }) => r.tier)).toEqual(['main', 'complex', 'standard']);

      const p = await seedTestProvider({ label: 'rroster' });
      const res = await rosterPUT(
        jsonReq({ tiers: [{ tier: 'complex', providerId: p.id, model: 'claude-opus-4-8' }] }, 'PUT') as never,
      );
      expect(res.status).toBe(200);
      const roster = await res.json();
      expect(roster.find((r: { tier: string }) => r.tier === 'complex').model).toBe('claude-opus-4-8');
    });

    it('unknown provider → 409; invalid tier → 400', async () => {
      mockCaller = asAdmin();
      expect(
        (
          await rosterPUT(
            jsonReq(
              { tiers: [{ tier: 'complex', providerId: '00000000-0000-0000-0000-000000000000', model: 'm' }] },
              'PUT',
            ) as never,
          )
        ).status,
      ).toBe(409);
      expect(
        (await rosterPUT(jsonReq({ tiers: [{ tier: 'nope', model: 'm' }] }, 'PUT') as never)).status,
      ).toBe(400);
    });
  });

  describe('connections verb contract', () => {
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
});
