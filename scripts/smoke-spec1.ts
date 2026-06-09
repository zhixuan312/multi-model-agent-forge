/**
 * Spec 1 end-to-end HTTP smoke test against a running `next start` + live DB.
 * Mints a real admin session, then exercises routing, auth-gating, the
 * admin Members API, and session revocation over HTTP.
 *
 *   1. terminal A:  PORT=3100 npx next start -p 3100
 *   2. terminal B:  BASE=http://127.0.0.1:3100 npx tsx scripts/smoke-spec1.ts
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member } from '@/db/schema';
import { PostgresSessionStore } from '@/auth/session-store';
import { SESSION_COOKIE_NAME } from '@/auth/config';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3100';
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/login`, { redirect: 'manual' });
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`server not ready at ${BASE} after ${timeoutMs}ms`);
}

async function main() {
  console.log('waiting for server…');
  await waitForServer();
  const db = getDb();
  const store = new PostgresSessionStore();

  const admin = (await db.select().from(member).where(eq(member.username, 'admin')).limit(1))[0];
  if (!admin) throw new Error('admin member not found — run npm run db:seed');
  const { token } = await store.create(admin.id);
  const cookie = `${SESSION_COOKIE_NAME}=${token}`;
  const auth = { headers: { cookie } };
  const json = (body: unknown) => ({
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  console.log(`\nSpec 1 HTTP smoke @ ${BASE}\n--- routing & gating ---`);
  const root = await fetch(`${BASE}/`, { redirect: 'manual' });
  check('GET / (no cookie) → 307 redirect', root.status === 307 || root.status === 308);

  const projNoAuth = await fetch(`${BASE}/projects`, { redirect: 'manual' });
  check('GET /projects (no cookie) → redirect to /login',
    [307, 308].includes(projNoAuth.status) && (projNoAuth.headers.get('location') ?? '').includes('/login'),
    `(got ${projNoAuth.status} → ${projNoAuth.headers.get('location')})`);

  const login = await fetch(`${BASE}/login`);
  check('GET /login → 200', login.status === 200);

  const projAuth = await fetch(`${BASE}/projects`, { ...auth, redirect: 'manual' });
  check('GET /projects (admin cookie) → 200', projAuth.status === 200, `(got ${projAuth.status})`);

  const settingsAuth = await fetch(`${BASE}/settings/members`, { ...auth, redirect: 'manual' });
  check('GET /settings/members (admin) → 200', settingsAuth.status === 200, `(got ${settingsAuth.status})`);

  console.log('--- admin Members API ---');
  const noCookie = await fetch(`${BASE}/api/members`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('POST /api/members (no cookie) → 401', noCookie.status === 401, `(got ${noCookie.status})`);

  const uname = `zz-smoke-${Date.now()}`;
  const created = await fetch(`${BASE}/api/members`, json({ username: uname, displayName: 'ZZ Smoke', password: 'smoke-pass-123456' }));
  const createdBody = await created.json().catch(() => ({}));
  check('POST /api/members (admin) → 201', created.status === 201, `(got ${created.status})`);
  const newId = createdBody.id as string | undefined;

  const dup = await fetch(`${BASE}/api/members`, json({ username: uname.toUpperCase(), displayName: 'Dup', password: 'smoke-pass-123456' }));
  check('POST /api/members duplicate (case-insensitive) → 409', dup.status === 409, `(got ${dup.status})`);

  const weak = await fetch(`${BASE}/api/members`, json({ username: `${uname}-w`, displayName: 'Weak', password: 'short' }));
  check('POST /api/members weak password → 400', weak.status === 400, `(got ${weak.status})`);

  if (newId) {
    const toggle = await fetch(`${BASE}/api/members/${newId}`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ isAdmin: true }) });
    check('PATCH /api/members/[id] toggle admin → 200', toggle.status === 200, `(got ${toggle.status})`);

    const reset = await fetch(`${BASE}/api/members/${newId}/password`, json({ newPassword: 'reset-pass-abcdef' }));
    check('POST /api/members/[id]/password reset → 204', reset.status === 204, `(got ${reset.status})`);

    const del = await fetch(`${BASE}/api/members/${newId}`, { method: 'DELETE', headers: { cookie } });
    check('DELETE /api/members/[id] → 200/204', [200, 204].includes(del.status), `(got ${del.status})`);

    const gone = (await db.select().from(member).where(eq(member.id, newId))).length === 0;
    check('member row deleted from DB', gone);
  }

  console.log('--- session lifecycle ---');
  const logout = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  check('POST /api/auth/logout → 200', logout.status === 200, `(got ${logout.status})`);

  const afterLogout = await fetch(`${BASE}/projects`, { ...auth, redirect: 'manual' });
  check('GET /projects after logout → redirect (session revoked)', [307, 308].includes(afterLogout.status), `(got ${afterLogout.status})`);

  // cleanup: ensure no leftover smoke rows
  await db.delete(member).where(eq(member.username, uname)).catch(() => {});

  console.log(`\n=== Spec 1 smoke: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SMOKE ERROR:', e); process.exit(1); });
