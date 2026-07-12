// @vitest-environment node
import { vi } from 'vitest';
import { NextResponse } from 'next/server';
import type { AuthedMember } from '@/auth/auth-provider';

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/admin-gate-handler', () => ({
  resolveAdminActor: async () =>
    mockCaller && mockCaller.role === 'team_admin'
      ? { ok: true, actor: mockCaller }
      : {
          ok: false,
          response: NextResponse.json(
            { error: mockCaller ? 'Admin privileges required.' : 'Unauthorized' },
            { status: mockCaller ? 403 : 401 },
          ),
        },
}));

let createResult: unknown = { kind: 'created', loop: { id: 'l1' }, eventToken: null };
const getResult: unknown = { id: 'l1' };
let updateResult: unknown = { kind: 'updated', loop: { id: 'l1' }, eventToken: null };
let rotateResult: unknown = { kind: 'rotated', loop: { id: 'l1' }, eventToken: 'new-token' };
const deleteResult: unknown = { kind: 'deleted' };
vi.mock('@/loops/loops-core', () => ({
  listLoops: async () => [{ id: 'l1' }],
  createLoop: async () => createResult,
  getLoop: async () => getResult,
  updateLoop: async () => updateResult,
  rotateLoopEventToken: async () => rotateResult,
  deleteLoop: async () => deleteResult,
}));

const { GET: listGET, POST: createPOST } = await import('../../app/api/loops/route');
const { GET: oneGET, PATCH, DELETE } = await import('../../app/api/loops/[id]/route');

const admin = (): AuthedMember => ({ id: 'a', username: 'admin', displayName: 'Admin', avatarTint: '#9a6b4f', role: 'team_admin', teamId: 'team-1' });
const member = (): AuthedMember => ({ id: 'm', username: 'm', displayName: 'M', avatarTint: '#9a6b4f', role: 'member', teamId: 'team-1' });
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

});

describe('Loops routes — event token mapping', () => {
  beforeEach(() => { mockCaller = admin(); });

  it('create returns the event token only on the creation response', async () => {
    createResult = { kind: 'created', loop: { id: 'l1' }, eventToken: 'plain-token' };
    const res = await createPOST(req({ mode: 'event', cron: null }) as never);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ loop: { id: 'l1' }, eventToken: 'plain-token' });
  });

  it('patch rotates when rotateEventToken=true and rejects wrong-mode rotations', async () => {
    rotateResult = { kind: 'rotated', loop: { id: 'l1' }, eventToken: 'rotated-token' };
    let res = await PATCH(req({ rotateEventToken: true }) as never, ctx('l1') as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ loop: { id: 'l1' }, eventToken: 'rotated-token' });

    rotateResult = { kind: 'wrong_mode' };
    res = await PATCH(req({ rotateEventToken: true }) as never, ctx('l1') as never);
    expect(res.status).toBe(409);
  });

  it('patch still maps update result kinds for ordinary edits', async () => {
    updateResult = { kind: 'updated', loop: { id: 'l1' }, eventToken: null };
    expect((await PATCH(req({ name: 'Retitled' }) as never, ctx('l1') as never)).status).toBe(200);
    updateResult = { kind: 'invalid_mode' };
    expect((await PATCH(req({ mode: 'event', cron: '0 3 * * *' }) as never, ctx('l1') as never)).status).toBe(400);
  });
});
