// @vitest-environment node
/**
 * Every link goes somewhere and every fetch hits a route that exists.
 *
 * Nothing checked either. A renamed page or a moved API route breaks its callers silently:
 * Next renders a 404 for the link and the fetch gets an HTML error page that `res.json()`
 * throws on, which the caller reports as "Network error". Both look like an outage rather
 * than a rename, and neither shows up in a type error — the href is a string and the fetch
 * URL is a template.
 *
 * The repo is clean today (32 page routes, 48 distinct fetch targets, 0 dangling). This keeps
 * it that way.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.next')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(p);
  }
  return out;
}

const SOURCES = [...walk('app'), ...walk('src')];
const read = (p: string) => readFileSync(p, 'utf8');

/** `app/(app)/projects/[id]/spec/page.tsx` → `/projects/[id]/spec` (route groups dropped). */
function pageRoutes(): string[] {
  const out: string[] = [];
  const rec = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.name === 'page.tsx') {
        const seg = dir.slice('app'.length).replace(/\/\([^)]*\)/g, '');
        out.push(seg || '/');
      }
    }
  };
  rec('app');
  return out;
}

function apiRoutes(): string[] {
  const out: string[] = [];
  const rec = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.name === 'route.ts') out.push('/api' + dir.slice('app/api'.length));
    }
  };
  rec('app/api');
  return out;
}

/** A route pattern → a regex, with `[param]` and `${expr}` both matching one segment. */
function routeMatcher(route: string): RegExp {
  const body = route
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith('[') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^/?${body}/?$`);
}

const normalize = (u: string) => u.replace(/\$\{[^}]*\}/g, 'X').split('?')[0]!;

describe('every internal link resolves to a page', () => {
  const routes = pageRoutes().map(routeMatcher);

  it('found the pages', () => {
    expect(pageRoutes().length).toBeGreaterThan(20);
    expect(pageRoutes()).toContain('/workspace');
  });

  it('has no href pointing at a page that does not exist', () => {
    const dangling: string[] = [];
    for (const f of SOURCES) {
      for (const m of read(f).matchAll(/href[=:]\s*['"](\/[a-zA-Z0-9/_\-[\]]*)['"]/g)) {
        const href = m[1]!;
        if (href.startsWith('/api')) continue;
        if (!routes.some((r) => r.test(href))) dangling.push(`${href} ← ${f}`);
      }
    }
    expect(dangling, 'a link to a page that is not there renders a 404').toEqual([]);
  });
});

describe('every fetch target resolves to an API route', () => {
  const routes = apiRoutes().map(routeMatcher);

  it('found the routes', () => {
    expect(apiRoutes().length).toBeGreaterThan(40);
    expect(apiRoutes()).toContain('/api/version');
  });

  it('has no fetch pointing at a route that does not exist', () => {
    const dangling: string[] = [];
    for (const f of SOURCES) {
      for (const m of read(f).matchAll(/fetch\(\s*[`'"](\/api\/[^`'"]*)/g)) {
        const url = normalize(m[1]!);
        if (!routes.some((r) => r.test(url))) dangling.push(`${url} ← ${f}`);
      }
    }
    expect(
      dangling,
      'a fetch to a missing route returns an HTML 404 that res.json() throws on — the caller reports a network error',
    ).toEqual([]);
  });
});
