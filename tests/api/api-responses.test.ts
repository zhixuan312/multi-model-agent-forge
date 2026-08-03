// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unauthorized, forbidden, ORG_ADMIN_REQUIRED, TEAM_ADMIN_REQUIRED } from '@/auth/api-responses';

/**
 * `{ error: 'Unauthorized' }, { status: 401 }` was written out THIRTY-SEVEN times, and
 * the two role refusals eight more. That is not merely repetition: the API has two error
 * envelopes (see `responseError`), so the SHAPE of a refusal is a decision, and 37 copies
 * is 37 places to make it differently.
 */
const ROOT = process.cwd();

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...routes(rel));
    else if (e.name === 'route.ts') out.push(rel);
  }
  return out;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...tsFiles(rel));
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
  }
  return out;
}

describe('shared API refusals', () => {
  it('unauthorized is a 401 carrying a readable reason', async () => {
    const res = unauthorized();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('forbidden is a 403 carrying the reason it was given', async () => {
    const res = forbidden(ORG_ADMIN_REQUIRED);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: ORG_ADMIN_REQUIRED });
  });

  it('names the two roles distinctly', () => {
    expect(ORG_ADMIN_REQUIRED).not.toBe(TEAM_ADMIN_REQUIRED);
    for (const m of [ORG_ADMIN_REQUIRED, TEAM_ADMIN_REQUIRED]) expect(m.endsWith('.')).toBe(true);
  });

  it('no route spells these refusals out again', () => {
    const LITERALS = [
      /error: 'Unauthorized' \}, \{ status: 401 \}/,
      /error: 'Org admin privileges required\.' \}, \{ status: 403 \}/,
      /error: 'Team admin privileges required\.' \}, \{ status: 403 \}/,
    ];
    const offenders: string[] = [];
    // Every file that can build a response, not a hand-picked few: the first version of
    // this listed three `src` guards by name and missed `middleware.ts`, which held a
    // 38th copy. A scan is only as good as the set it walks.
    for (const rel of [...routes('app/api'), ...tsFiles('src'), 'middleware.ts']) {
      if (rel === 'src/auth/api-responses.ts') continue; // the module that DEFINES them
      const text = readFileSync(join(ROOT, rel), 'utf8');
      if (LITERALS.some((re) => re.test(text))) offenders.push(rel);
    }
    expect(offenders, 'use unauthorized() / forbidden() from @/auth/api-responses').toEqual([]);
  });

  /** An unauthenticated caller must be told so, not handed a plausible empty result. */
  it('every route answers a missing session with 401, never an empty 200', () => {
    const offenders = routes('app/api').filter((rel) => {
      const t = readFileSync(join(ROOT, rel), 'utf8');
      return /if \(!\w+\) return NextResponse\.json\(\{ items: \[\] \}\)/.test(t);
    });
    expect(offenders, 'return unauthorized() so the client can tell a lost session from no data').toEqual([]);
  });
});
