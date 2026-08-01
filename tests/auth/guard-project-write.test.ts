// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createMockDb } from '../test-utils/mock-db';

/**
 * `guardProjectWrite` is the single CSRF → auth → membership gate in front of every
 * project write route (11 call sites). It had no direct test: the route suites all
 * `vi.mock` it, so every assertion about it was an assertion about the mock.
 *
 * That is the wrong thing to leave uncovered. It was previously three duplicated
 * copies, and the ordering inside it is load-bearing — CSRF must be rejected BEFORE
 * the session is read, and membership must be checked before any write proceeds.
 * These pin the order and each failure mode.
 */
const { currentMember, assertProjectReadable, ProjectAccessError, getDb } = vi.hoisted(() => {
  class ProjectAccessError extends Error {}
  return {
    currentMember: vi.fn(),
    assertProjectReadable: vi.fn(),
    ProjectAccessError,
    getDb: vi.fn(),
  };
});

vi.mock('@/auth/current-member', () => ({ currentMember }));
vi.mock('@/projects/projects-core', () => ({ assertProjectReadable, ProjectAccessError }));
vi.mock('@/db/client', () => ({ getDb }));

const { guardProjectWrite } = await import('@/auth/guard-project-write');

const MEMBER = { id: 'm-1', teamId: 't-1', displayName: 'Ada', avatarTint: '#9a6b4f' };

/** A request that passes the same-origin check. */
const sameOrigin = () =>
  new NextRequest('https://forge.test/api/projects/p1/spec/approve', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin' },
  });

/** A request a malicious site would produce. */
const crossSite = () =>
  new NextRequest('https://forge.test/api/projects/p1/spec/approve', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  currentMember.mockResolvedValue(MEMBER);
  assertProjectReadable.mockResolvedValue(undefined);
  getDb.mockReturnValue(createMockDb({ 'select:project': [{ phase: 'design' }] }));
});

describe('guardProjectWrite — the happy path', () => {
  it('returns the actor with BOTH memberId and the full member', async () => {
    const r = await guardProjectWrite(sameOrigin(), 'p1');
    expect(r).toEqual({ memberId: 'm-1', member: MEMBER });
  });

  it('does not consult the project phase unless asked', async () => {
    const db = createMockDb({ 'select:project': [{ phase: 'build' }] });
    getDb.mockReturnValue(db);
    // phase is 'build' (frozen), but without requireUnfrozen the write is allowed —
    // this is exactly the difference the old explore/build guards encoded.
    const r = await guardProjectWrite(sameOrigin(), 'p1');
    expect(r).toEqual({ memberId: 'm-1', member: MEMBER });
    expect(db._wasCalled('project', 'select')).toBe(false);
  });
});

describe('guardProjectWrite — CSRF is rejected FIRST', () => {
  it('returns 403 for a cross-site request', async () => {
    const r = await guardProjectWrite(crossSite(), 'p1');
    expect(r).toBeInstanceOf(NextResponse);
    expect((r as NextResponse).status).toBe(403);
  });

  it('does not read the session or touch the database on a cross-site request', async () => {
    // Ordering matters: a rejected cross-site POST must not cause a session lookup
    // or a membership query to run at all.
    await guardProjectWrite(crossSite(), 'p1');
    expect(currentMember).not.toHaveBeenCalled();
    expect(assertProjectReadable).not.toHaveBeenCalled();
  });
});

describe('guardProjectWrite — authentication', () => {
  it('401s when there is no session', async () => {
    currentMember.mockResolvedValue(null);
    const r = (await guardProjectWrite(sameOrigin(), 'p1')) as NextResponse;
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'Unauthorized' });
  });

  it('401s when the member has no team, rather than treating them as scopeless', async () => {
    currentMember.mockResolvedValue({ ...MEMBER, teamId: null });
    const r = (await guardProjectWrite(sameOrigin(), 'p1')) as NextResponse;
    expect(r.status).toBe(401);
  });

  it('does not check membership when unauthenticated', async () => {
    currentMember.mockResolvedValue(null);
    await guardProjectWrite(sameOrigin(), 'p1');
    expect(assertProjectReadable).not.toHaveBeenCalled();
  });
});

describe('guardProjectWrite — membership', () => {
  it('403s (not 404) when the actor cannot read the project', async () => {
    assertProjectReadable.mockRejectedValue(new ProjectAccessError('nope'));
    const r = (await guardProjectWrite(sameOrigin(), 'p1')) as NextResponse;
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'Forbidden' });
  });

  it('RETHROWS an unexpected error instead of masking it as Forbidden', async () => {
    // A database outage must surface as a 500, not be reported to the user as a
    // permission problem.
    assertProjectReadable.mockRejectedValue(new Error('connection refused'));
    await expect(guardProjectWrite(sameOrigin(), 'p1')).rejects.toThrow('connection refused');
  });

  it('scopes the check to the actor\u2019s team', async () => {
    await guardProjectWrite(sameOrigin(), 'p1');
    expect(assertProjectReadable).toHaveBeenCalledWith('p1', { id: 'm-1', teamId: 't-1' });
  });
});

describe('guardProjectWrite — requireUnfrozen phase check', () => {
  it('passes while the project is still in design', async () => {
    getDb.mockReturnValue(createMockDb({ 'select:project': [{ phase: 'design' }] }));
    const r = await guardProjectWrite(sameOrigin(), 'p1', { requireUnfrozen: true });
    expect(r).toEqual({ memberId: 'm-1', member: MEMBER });
  });

  it('409s once the project has left design', async () => {
    getDb.mockReturnValue(createMockDb({ 'select:project': [{ phase: 'build' }] }));
    const r = (await guardProjectWrite(sameOrigin(), 'p1', { requireUnfrozen: true })) as NextResponse;
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'Spec is locked — read-only.' });
  });

  it('404s when the project row is gone', async () => {
    getDb.mockReturnValue(createMockDb({ 'select:project': [] }));
    const r = (await guardProjectWrite(sameOrigin(), 'p1', { requireUnfrozen: true })) as NextResponse;
    expect(r.status).toBe(404);
  });

  it('still runs the phase check only AFTER auth and membership', async () => {
    currentMember.mockResolvedValue(null);
    const db = createMockDb({ 'select:project': [{ phase: 'design' }] });
    getDb.mockReturnValue(db);
    await guardProjectWrite(sameOrigin(), 'p1', { requireUnfrozen: true });
    expect(db._wasCalled('project', 'select')).toBe(false);
  });
});
