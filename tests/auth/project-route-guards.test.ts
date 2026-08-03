// @vitest-environment node
/**
 * Every project-scoped API route must establish that the caller may see the project.
 *
 * Most do it at the route, through `guardProjectWrite` / `guardProjectRead`. The four
 * export routes do it one layer down: they take only `currentMember`, and the collectors
 * in `export/collect-artifacts.ts` call `assertProjectReadable` before reading anything.
 * That is a legitimate place for the check — a data-access chokepoint is harder to bypass
 * than a route convention — but it means a reader auditing routes sees "logged in" and has
 * to trace two modules to find the membership test, and a NEW export route that reads
 * artifacts some other way would have no check at all.
 *
 * So the allowlist below is explicit: a route may skip the route-level guard only by being
 * named here, with the function that guards it instead. Anything else fails.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'app/api/projects';

/**
 * Route → the chain that performs `assertProjectReadable` for it. `calls` is what the ROUTE
 * imports; `collector` is the function in `collect-artifacts.ts` that actually asserts. Both
 * hops are verified below, so a service that stops going through its collector fails here
 * rather than silently unguarding its route.
 */
const GUARDED_BY_SERVICE: Record<string, { calls: string; collector: string }> = {
  '[id]/export/artifacts/route.ts': { calls: 'collectMenu', collector: 'collectMenu' },
  '[id]/export/md/route.ts': { calls: 'exportMd', collector: 'collectArtifact' },
  '[id]/export/pdf/route.ts': { calls: 'exportPdf', collector: 'collectArtifact' },
  '[id]/export/bundle/route.ts': { calls: 'exportBundle', collector: 'collectReadyArtifacts' },
};

const ROUTE_GUARDS = ['guardProjectWrite', 'guardProjectRead'];

function routes(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...routes(join(dir, e.name), rel));
    else if (e.name === 'route.ts') out.push(rel);
  }
  return out;
}

const all = routes('.');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('every project route establishes project membership', () => {
  it('found the routes', () => {
    expect(all.length).toBeGreaterThan(15);
    expect(all).toContain('[id]/transition/route.ts');
  });

  it('guards at the route, or names the service that guards instead', () => {
    const unguarded = all.filter((rel) => {
      const src = read(rel);
      if (ROUTE_GUARDS.some((g) => src.includes(g))) return false;
      const via = GUARDED_BY_SERVICE[rel];
      return !(via && src.includes(via.calls));
    });
    expect(
      unguarded,
      'call guardProjectWrite/guardProjectRead, or add the route to GUARDED_BY_SERVICE with the function that calls assertProjectReadable',
    ).toEqual([]);
  });

/**
 * One function's body, bounded by the NEXT top-level declaration.
 *
 * This was a fixed 900-character slice, which runs straight past the end of a short
 * function into its neighbour — and the neighbour here also calls `assertProjectReadable`.
 * Deleting the assert from `collectArtifact` left the test green. A window that can see the
 * next function is not reading the function it names.
 */
function bodyOf(source: string, fn: string): string | null {
  const start = source.indexOf(`export async function ${fn}(`);
  if (start === -1) return null;
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

  /** The allowlist is only as good as the claim it makes — so verify both hops. */
  it('the service each route calls still goes through a collector that asserts', () => {
    const service = readFileSync('src/export/service.ts', 'utf8');
    const collectors = readFileSync('src/export/collect-artifacts.ts', 'utf8');

    for (const [rel, { calls, collector }] of Object.entries(GUARDED_BY_SERVICE)) {
      // Hop 1: the service function reaches the collector (skipped when the route calls
      // the collector itself).
      if (calls !== collector) {
        const body = bodyOf(service, calls);
        expect(body, `${calls} (called by ${rel}) is not in export/service.ts`).not.toBeNull();
        expect(body!, `${calls} no longer goes through ${collector} — ${rel} is unguarded`)
          .toContain(collector);
      }
      // Hop 2: the collector asserts readability.
      const cBody = bodyOf(collectors, collector);
      expect(cBody, `${collector} is not in collect-artifacts.ts`).not.toBeNull();
      expect(cBody!, `${collector} no longer calls assertProjectReadable — ${rel} is unguarded`)
        .toContain('assertProjectReadable');
    }
  });

  /** A stale allowlist entry is a route that could quietly lose its guard later. */
  it('has no allowlist entry for a route that does not exist', () => {
    expect(Object.keys(GUARDED_BY_SERVICE).filter((rel) => !all.includes(rel))).toEqual([]);
  });

  /**
   * A state-changing method needs the CSRF check too. `guardProjectWrite` does it; the
   * routes that use the READ guard for a mutation call `rejectCrossOrigin` themselves.
   */
  it('every mutating route performs a CSRF check', () => {
    const missing = all.filter((rel) => {
      const src = read(rel);
      const mutates = /export async function (POST|PUT|PATCH|DELETE)/.test(src);
      if (!mutates) return false;
      return !src.includes('guardProjectWrite') && !src.includes('rejectCrossOrigin');
    });
    expect(missing, 'a mutating route must reject cross-origin requests').toEqual([]);
  });
});
