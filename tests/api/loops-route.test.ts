// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// Admin gate + result-kind → HTTP mapping for the Loops routes. The core is
// mocked (covered by loops-core.test); no database (gumi convention).
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

let createResult: unknown = { kind: 'created', loop: { id: 'l1' } };
let getResult: unknown = { id: 'l1' };
let updateResult: unknown = { kind: 'updated', loop: { id: 'l1' } };
let deleteResult: unknown = { kind: 'deleted' };
vi.mock('@/loops/loops-core', () => ({
  listLoops: async () => [{ id: 'l1' }],
  createLoop: async () => createResult,
  getLoop: async () => getResult,
  updateLoop: async () => updateResult,
  deleteLoop: async () => deleteResult,
}));

const { GET: listGET, POST: createPOST } = await import('../../app/api/loops/route');
const { GET: oneGET, PATCH, DELETE } = await import('../../app/api/loops/[id]/route');

const admin = (): AuthedMember => ({ id: 'a', username: 'admin', displayName: 'Admin', avatarTint: '#9a6b4f', isAdmin: true });
const member = (): AuthedMember => ({ id: 'm', username: 'm', displayName: 'M', avatarTint: '#9a6b4f', isAdmin: false });
const req = (body: unknown) => new Request('http://localhost/api/loops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('Loops routes — admin gate', () => {
  beforeEach(() => { mockCaller = null; });

  it('non-admin → 403 across list/create/get/patch/delete', async () => {
    mockCaller = member();
    expect((await listGET()).status).toBe(403);
    expect((await createPOST(req({}) as never)).status).toBe(403);
    expect((await oneGET(req({}) as never, ctx('l1') as never)).status).toBe(403);
    expect((await PATCH(req({}) as never, ctx('l1') as never)).status).toBe(403);
    expect((await DELETE(req({}) as never, ctx('l1') as never)).status).toBe(403);
  });

  it('unauthenticated → 401', async () => {
    mockCaller = null;
    expect((await listGET()).status).toBe(401);
    expect((await createPOST(req({}) as never)).status).toBe(401);
  });
});

describe('Loops routes — result-kind → HTTP', () => {
  beforeEach(() => { mockCaller = admin(); });

  it('create: created→201, duplicate→409, invalid_cron→400', async () => {
    createResult = { kind: 'created', loop: { id: 'l1' } };
    expect((await createPOST(req({}) as never)).status).toBe(201);
    createResult = { kind: 'duplicate_name' };
    expect((await createPOST(req({}) as never)).status).toBe(409);
    createResult = { kind: 'invalid_cron' };
    expect((await createPOST(req({}) as never)).status).toBe(400);
  });

  it('get: row→200, null→404', async () => {
    getResult = { id: 'l1' };
    expect((await oneGET(req({}) as never, ctx('l1') as never)).status).toBe(200);
    getResult = null;
    expect((await oneGET(req({}) as never, ctx('x') as never)).status).toBe(404);
  });

  it('patch: updated→200, not_found→404', async () => {
    updateResult = { kind: 'updated', loop: { id: 'l1' } };
    expect((await PATCH(req({ enabled: false }) as never, ctx('l1') as never)).status).toBe(200);
    updateResult = { kind: 'not_found' };
    expect((await PATCH(req({}) as never, ctx('x') as never)).status).toBe(404);
  });

  it('delete: deleted→204, not_found→404', async () => {
    deleteResult = { kind: 'deleted' };
    expect((await DELETE(req({}) as never, ctx('l1') as never)).status).toBe(204);
    deleteResult = { kind: 'not_found' };
    expect((await DELETE(req({}) as never, ctx('x') as never)).status).toBe(404);
  });
});
