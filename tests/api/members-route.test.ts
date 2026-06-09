// @vitest-environment node
import { vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member } from '@/db/schema/identity';
import type { AuthedMember } from '@/auth/auth-provider';
import {
  seedTestMember,
  cleanupTestMembers,
  closeDb,
  uniqueUsername,
} from '../auth/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const strongPassword = 'a-strong-password-1234';

// The admin gate resolves the caller via current-member.ts (which reads the
// cookie). Mock it so we can drive the handler as admin / non-admin / anon
// without minting cookies — current-member.ts itself is covered by its own
// live-DB test.
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

// Import the handlers AFTER the mock is registered.
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

describe.skipIf(!hasDb)('Members API route handlers (admin gate + verb contract)', () => {
  const db = getDb();

  afterAll(async () => {
    await cleanupTestMembers();
    await closeDb();
  });

  beforeEach(() => {
    mockCaller = null;
  });

  describe('admin gate', () => {
    it('non-admin → 403', async () => {
      mockCaller = asMember();
      const res = await createPOST(
        jsonReq({ displayName: 'X', username: uniqueUsername('gate'), password: strongPassword }) as never,
      );
      expect(res.status).toBe(403);
    });

    it('unauthenticated → 401', async () => {
      mockCaller = null;
      const res = await createPOST(
        jsonReq({ displayName: 'X', username: uniqueUsername('anon'), password: strongPassword }) as never,
      );
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/members', () => {
    it('admin create → 201 with the created shape (no password echoed)', async () => {
      mockCaller = asAdmin();
      const username = uniqueUsername('rcreate');
      const res = await createPOST(
        jsonReq({ displayName: 'Routed', username, password: strongPassword }) as never,
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.username).toBe(username);
      expect(body.isAdmin).toBe(false);
      expect(JSON.stringify(body)).not.toContain(strongPassword);
    });

    it('duplicate username → 409', async () => {
      mockCaller = asAdmin();
      const username = uniqueUsername('rdup');
      await createPOST(jsonReq({ displayName: 'A', username, password: strongPassword }) as never);
      const res = await createPOST(
        jsonReq({ displayName: 'B', username, password: strongPassword }) as never,
      );
      expect(res.status).toBe(409);
    });

    it('weak password → 400', async () => {
      mockCaller = asAdmin();
      const res = await createPOST(
        jsonReq({ displayName: 'W', username: uniqueUsername('rweak'), password: 'short' }) as never,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/members/[id]', () => {
    it('toggles admin → 200', async () => {
      mockCaller = asAdmin();
      const target = await seedTestMember({ label: 'rtoggle' });
      const res = await PATCH(jsonReq({ isAdmin: true }) as never, {
        params: Promise.resolve({ id: target.id }),
      });
      expect(res.status).toBe(200);
      const [row] = await db.select({ isAdmin: member.isAdmin }).from(member).where(eq(member.id, target.id));
      expect(row.isAdmin).toBe(true);
    });
  });

  describe('POST /api/members/[id]/password', () => {
    it('reset → 204', async () => {
      mockCaller = asAdmin();
      const target = await seedTestMember({ label: 'rreset' });
      const res = await resetPOST(jsonReq({ newPassword: strongPassword }) as never, {
        params: Promise.resolve({ id: target.id }),
      });
      expect(res.status).toBe(204);
    });
  });

  describe('DELETE /api/members/[id]', () => {
    it('delete a non-admin → 204', async () => {
      mockCaller = asAdmin();
      const target = await seedTestMember({ label: 'rdel' });
      const res = await DELETE(jsonReq({}) as never, {
        params: Promise.resolve({ id: target.id }),
      });
      expect(res.status).toBe(204);
      const rows = await db.select().from(member).where(eq(member.id, target.id));
      expect(rows).toHaveLength(0);
    });
  });
});
