// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';
import { createMockDb } from '../test-utils/mock-db';

/**
 * Cross-tenant guard for the Loops API.
 *
 * `resolveAdminActor` admits BOTH `org_admin` and `team_admin`, and an org admin has
 * `teamId: null`. Every loops handler used to pass `gate.actor.teamId ?? undefined` into
 * the core, and `loops-core` treats a missing team as "no filter":
 *
 *     const where = deps.teamId ? and(eq(loop.id, id), eq(loop.teamId, deps.teamId))
 *                              : eq(loop.id, id);
 *
 * so an org admin listed, read, edited, DELETED and rotated the event token of every
 * team's loops — and could fire "Run now", which dispatches a code-changing agent against
 * that team's repo. Verified before the fix: GET returned another team's row with ZERO
 * where-clauses bound.
 *
 * Three things showed this was unintended rather than a superuser feature:
 *   1. `resolveAdminTeam` exists for exactly this ("so the core never runs team-less") and
 *      all five `repos` handlers already used it;
 *   2. `createLoop` already failed CLOSED (`if (!deps.teamId) return { kind: 'invalid' }`),
 *      so creating was scoped while reading and deleting were not;
 *   3. the product's own navigation gives an org admin NO Loops surface at all
 *      (`Sidebar.test.tsx`: "org_admin only Usage and Org settings").
 *
 * The loops routes now use `resolveAdminTeam`, which answers 400 for a team-less admin
 * instead of silently going global.
 */
let caller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => caller,
  currentSession: async () => null,
}));

const OTHER_TEAM_LOOP = { id: 'other-teams-loop', teamId: 'team-B', eventTokenHash: null };
let db = createMockDb({ 'select:loop_def': [OTHER_TEAM_LOOP] });
vi.mock('@/db/client', () => ({ getDb: () => db }));

const startLoopRun = vi.fn(async () => ({ kind: 'started' as const, runId: 'r1' }));
vi.mock('@/loops/run-now', () => ({ startLoopRun }));

const { GET: listGET, POST: createPOST } = await import('../../app/api/loops/route');
const { GET: oneGET, PATCH, DELETE } = await import('../../app/api/loops/[id]/route');
const { POST: runPOST } = await import('../../app/api/loops/[id]/run/route');

const orgAdmin: AuthedMember = {
  id: 'oa', username: 'oa', displayName: 'Org Admin', avatarTint: '#000',
  role: 'org_admin', teamId: null,
};

const ctx = (id = 'other-teams-loop') => ({ params: Promise.resolve({ id }) });
const req = (body: unknown = {}) =>
  new Request('http://localhost/api/loops', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

beforeEach(() => {
  caller = orgAdmin;
  db = createMockDb({ 'select:loop_def': [OTHER_TEAM_LOOP] });
  startLoopRun.mockClear();
});

describe('Loops API — a team-less admin is refused, never served globally', () => {
  it('GET /api/loops does not return another team loops', async () => {
    const res = await listGET();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('team-B');
  });

  it('GET /api/loops/[id] does not read another team loop', async () => {
    const res = await oneGET(req() as never, ctx() as never);
    expect(res.status).toBe(400);
  });

  it('PATCH does not edit another team loop', async () => {
    const res = await PATCH(req({ name: 'Renamed' }) as never, ctx() as never);
    expect(res.status).toBe(400);
    expect(db._wasCalled('loop_def', 'update')).toBe(false);
  });

  it('PATCH does not rotate another team event token', async () => {
    const res = await PATCH(req({ rotateEventToken: true }) as never, ctx() as never);
    expect(res.status).toBe(400);
    expect(db._wasCalled('loop_def', 'update')).toBe(false);
  });

  it('DELETE does not remove another team loop', async () => {
    const res = await DELETE(req() as never, ctx() as never);
    expect(res.status).toBe(400);
    expect(db._wasCalled('loop_def', 'delete')).toBe(false);
  });

  it('POST /run does not fire a code-changing agent on another team repo', async () => {
    // The most destructive of the set: a loop run dispatches an agent that commits.
    const res = await runPOST(req() as never, ctx() as never);
    expect(res.status).toBe(400);
    expect(startLoopRun).not.toHaveBeenCalled();
  });

  it('POST /api/loops does not create a loop with no team', async () => {
    const res = await createPOST(req({ name: 'X', kind: 'maintenance', config: { goalMd: 'g' }, mode: 'manual', cron: null, repoIds: [] }) as never);
    expect(res.status).toBe(400);
    expect(db._wasCalled('loop_def', 'insert')).toBe(false);
  });
});
