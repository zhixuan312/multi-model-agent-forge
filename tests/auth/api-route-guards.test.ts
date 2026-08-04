// @vitest-environment node
/**
 * Every API route states how it is protected, and this file is the statement.
 *
 * `project-route-guards.test.ts` covers `app/api/projects/**` — the routes that need PROJECT
 * membership. This one covers the other 32, which need something else: an admin gate, a team
 * scope, a session, a bearer token, or nothing at all. There was no list. Auditing them meant
 * grepping for guard names you already knew, which finds the routes that use the guards you
 * thought of and silently passes the ones that don't.
 *
 * Adding a route means adding a line here. That is the point: a new endpoint cannot be
 * unprotected by omission, only by a deliberate `'public'` that a reviewer can see.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'app/api';

/**
 * How each non-project route establishes who is calling.
 *  - a guard name → that symbol must appear in the route
 *  - 'public'     → deliberately unauthenticated, with the reason stated here
 */
const GUARD: Record<string, string> = {
  // Session-only: any signed-in member.
  // Logout resolves the session from the cookie itself rather than through
  // `currentMember` — it must work for a session that is expired or already revoked, which
  // those helpers reject. CSRF still applies (it deletes a row).
  'auth/logout/route.ts': 'sessionStore',
  'auth/password/route.ts': 'currentSession',
  'connections/route.ts': 'currentMember',
  'members/route.ts': 'currentMember',
  'notifications/[id]/read/route.ts': 'currentMember',
  'notifications/list/route.ts': 'currentMember',
  'notifications/read-all/route.ts': 'currentMember',
  'profile/route.ts': 'currentMember',
  'team/workspace/route.ts': 'currentMember',
  'teams/[id]/assign-admin/route.ts': 'currentMember',
  'teams/[id]/members/route.ts': 'currentMember',
  'teams/[id]/route.ts': 'currentMember',
  'teams/route.ts': 'currentMember',
  'transcribe/route.ts': 'currentMember',

  // Admin gates.
  'configure-provider/route.ts': 'resolveAdminActor',
  'connections/validate/route.ts': 'resolveAdminActor',
  'members/[id]/password/route.ts': 'resolveAdminActor',
  'members/[id]/route.ts': 'resolveAdminActor',
  'loops/[id]/route.ts': 'resolveAdminTeam',
  'loops/[id]/run/route.ts': 'resolveAdminTeam',
  'loops/route.ts': 'resolveAdminTeam',
  'repos/[id]/route.ts': 'resolveAdminTeam',
  'repos/route.ts': 'resolveAdminTeam',

  // The team-level journal: authenticated + team-scoped, no per-project membership.
  'journal/nodes/[id]/route.ts': 'guardJournal',
  'journal/nodes/route.ts': 'guardJournal',
  'journal/pins/[id]/refresh/route.ts': 'guardJournal',
  'journal/pins/[id]/route.ts': 'guardJournal',
  'journal/pins/route.ts': 'guardJournal',
  'journal/recall/[batchId]/route.ts': 'guardJournal',
  'journal/recall/route.ts': 'guardJournal',

  // Machine caller with a per-loop bearer token, not a session — `acceptLoopEvent`
  // verifies it (`verifyEventToken`, timing-safe) before doing anything.
  'loops/[id]/events/route.ts': 'acceptLoopEvent',

  // PUBLIC BY DESIGN: the deploy's identity probe. `/release-forge` Phase 5b curls it
  // before any credential exists, and the release notes record the digest it returns.
  // It exposes version, git sha and build time — nothing tenant-scoped.
  'version/route.ts': 'public',
};

function routes(dir = '.', prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...routes(join(dir, e.name), rel));
    else if (e.name === 'route.ts') out.push(rel);
  }
  return out;
}

const all = routes().filter((r) => !r.startsWith('projects/'));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('every API route outside app/api/projects declares its guard', () => {
  it('found the routes', () => {
    expect(all.length).toBeGreaterThan(25);
    expect(all).toContain('version/route.ts');
  });

  it('has an entry for every route', () => {
    const undeclared = all.filter((rel) => !(rel in GUARD));
    expect(
      undeclared,
      'add the route to GUARD with the symbol that authenticates it, or "public" with the reason',
    ).toEqual([]);
  });

  it('has no entry for a route that no longer exists', () => {
    expect(Object.keys(GUARD).filter((rel) => !all.includes(rel))).toEqual([]);
  });

  it('actually calls the guard it declares', () => {
    const lying = all.filter((rel) => {
      const guard = GUARD[rel];
      if (!guard || guard === 'public') return false;
      return !read(rel).includes(guard);
    });
    expect(lying, 'the declared guard is not called in the route').toEqual([]);
  });

  /**
   * A state-changing method must reject cross-origin requests. The journal routes do it
   * inside `guardJournal({ checkCsrf: true })`; the loop-event endpoint is a machine caller
   * authenticated by a bearer token, where same-origin means nothing.
   */
  it('every mutating route performs a CSRF check', () => {
    const CSRF_BY_GUARD = new Set(['guardJournal']);
    const NO_CSRF_BY_DESIGN = new Set(['loops/[id]/events/route.ts']);

    const missing = all.filter((rel) => {
      if (NO_CSRF_BY_DESIGN.has(rel)) return false;
      const src = read(rel);
      if (!/export async function (POST|PUT|PATCH|DELETE)/.test(src)) return false;
      if (src.includes('rejectCrossOrigin')) return false;
      return !CSRF_BY_GUARD.has(GUARD[rel] ?? '');
    });
    expect(missing, 'a mutating route must reject cross-origin requests').toEqual([]);
  });

  /** The one public route stays deliberately small. */
  it('only /api/version is public', () => {
    expect(Object.entries(GUARD).filter(([, g]) => g === 'public').map(([r]) => r))
      .toEqual(['version/route.ts']);
  });
});
