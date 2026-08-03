// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `same-origin.ts` states the policy outright: "Every cookie-authenticated mutation route
 * must reject a forged cross-origin request even with a valid admin session." It named
 * settings, providers, roster and connections — and none of those had it. Twenty-two
 * mutating routes carried no check at all.
 *
 * `SameSite=Lax` is the primary control and it is why this was not an open hole: a
 * CROSS-SITE post carries no session cookie. But Lax does not cover SAME-SITE requests
 * from another subdomain, which `rejectCrossOrigin` explicitly refuses — so the routes
 * without it were defended by one layer where the policy called for two.
 */
const ROOT = process.cwd();

/** Guards that call `rejectCrossOrigin` internally. */
const INDIRECT = ['guardJournal', 'guardProjectWrite'];

/**
 * The loop EVENT endpoint is machine-authenticated by a bearer token in the
 * `authorization` header and is called cross-origin BY DESIGN — a same-origin check
 * would break every external trigger. It carries no cookie session to forge.
 */
const MACHINE_ENDPOINTS = ['app/api/loops/[id]/events/route.ts'];

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...routes(rel));
    else if (e.name === 'route.ts') out.push(rel);
  }
  return out;
}

describe('CSRF coverage', () => {
  const all = routes('app/api');
  const mutating = all.filter((rel) =>
    /export async function (POST|PUT|PATCH|DELETE)/.test(readFileSync(join(ROOT, rel), 'utf8')),
  );

  it('found the API tree and its mutating routes', () => {
    expect(all.length).toBeGreaterThan(40);
    expect(mutating.length).toBeGreaterThan(30);
  });

  it('every cookie-authenticated mutation route enforces same-origin', () => {
    const unguarded = mutating
      .filter((rel) => !MACHINE_ENDPOINTS.includes(rel))
      .filter((rel) => {
        const text = readFileSync(join(ROOT, rel), 'utf8');
        return !['rejectCrossOrigin', ...INDIRECT].some((g) => text.includes(g));
      });
    expect(unguarded, 'call rejectCrossOrigin (or a guard that does) first').toEqual([]);
  });

  it('leaves the machine endpoint alone — it is cross-origin by design', () => {
    for (const rel of MACHINE_ENDPOINTS) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      expect(text, rel).not.toContain('rejectCrossOrigin');
      expect(text, rel).toContain('authorization');
    }
  });
});

/** The guard itself — what it accepts and what it turns away. */
describe('rejectCrossOrigin', () => {
  const req = (headers: Record<string, string>) =>
    ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as never;

  it('allows a same-origin request', async () => {
    const { rejectCrossOrigin } = await import('@/auth/same-origin');
    expect(rejectCrossOrigin(req({ 'sec-fetch-site': 'same-origin' }))).toBeNull();
  });

  /** Direct navigation and the header-less clients tests construct. */
  it('allows a request with no origin information at all', async () => {
    const { rejectCrossOrigin } = await import('@/auth/same-origin');
    expect(rejectCrossOrigin(req({ 'sec-fetch-site': 'none' }))).toBeNull();
    expect(rejectCrossOrigin(req({}))).toBeNull();
  });

  /**
   * `same-site` is the case `SameSite=Lax` does NOT cover — another subdomain — which is
   * exactly why the cookie is not the only control.
   */
  it('rejects cross-site AND same-site', async () => {
    const { rejectCrossOrigin } = await import('@/auth/same-origin');
    expect(rejectCrossOrigin(req({ 'sec-fetch-site': 'cross-site' }))?.status).toBe(403);
    expect(rejectCrossOrigin(req({ 'sec-fetch-site': 'same-site' }))?.status).toBe(403);
  });

  it('falls back to comparing Origin against Host', async () => {
    const { rejectCrossOrigin } = await import('@/auth/same-origin');
    expect(rejectCrossOrigin(req({ origin: 'https://forge.example', host: 'forge.example' }))).toBeNull();
    expect(rejectCrossOrigin(req({ origin: 'https://evil.example', host: 'forge.example' }))?.status).toBe(403);
    expect(rejectCrossOrigin(req({ origin: 'not a url', host: 'forge.example' }))?.status).toBe(403);
  });
});
