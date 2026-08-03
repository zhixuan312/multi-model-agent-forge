// @vitest-environment node
/**
 * A batch is either still working or finished, and the split has to be exhaustive.
 *
 * It was written out by hand instead: `['dispatched', 'running']` in six places and
 * `['done', 'failed']` in eight. The eight were wrong. Engine 5.16 added `cancelled`, which
 * `dispatch-helpers` persists TOGETHER WITH the batch's `costUsd`, tokens and duration — and
 * every query behind the Usage page filtered it out. The cost dashboard under-reported real
 * spend by the entire cost of every cancelled run, on every tab, silently.
 *
 * A subset like that is invisible to `enum-single-source.test.ts` by design: a deliberate
 * narrowing must stay legal. So the protection has to be this — declare the in-flight side,
 * derive the other, and refuse a hand-written status list at the query sites.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MMA_STATUS, INFLIGHT_MMA_STATUS, TERMINAL_MMA_STATUS } from '@/db/enums';

describe('in-flight / terminal is a partition of MMA_STATUS', () => {
  it('covers every status exactly once', () => {
    expect([...INFLIGHT_MMA_STATUS, ...TERMINAL_MMA_STATUS].sort()).toEqual([...MMA_STATUS].sort());
    expect(INFLIGHT_MMA_STATUS.filter((s) => (TERMINAL_MMA_STATUS as readonly string[]).includes(s))).toEqual([]);
  });

  /** The bug, named. A cancelled run cost money; it is finished, and it counts. */
  it('treats cancelled as terminal', () => {
    expect(TERMINAL_MMA_STATUS).toContain('cancelled');
    expect(TERMINAL_MMA_STATUS).toEqual(expect.arrayContaining(['done', 'failed', 'cancelled']));
  });

  /**
   * Derivation direction matters: a status added to `MMA_STATUS` is terminal unless it is
   * named in-flight. The other direction — listing the terminal ones — is how `cancelled`
   * got left out for a whole release.
   */
  it('is derived from MMA_STATUS, not listed alongside it', () => {
    const src = readFileSync('src/db/enums.ts', 'utf8');
    expect(src).toMatch(/TERMINAL_MMA_STATUS[^=]*=\s*MMA_STATUS\.filter/);
  });
});

describe('no query hand-lists batch statuses', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.next')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) files.push(p);
    }
  };
  walk('src');
  walk('app');

  it('found the source tree', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  /**
   * `reconcileStuckAttempts` is the one exception, and it is documented where it sits: it
   * wants the UNSUCCESSFUL terminals only, because a `done` batch is closed by its own
   * handler and flipping it here would race that. A third named subset for one caller would
   * be worse than the literal it explains.
   */
  it('uses the derived constants, not a literal array', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith('details-actions.ts')) continue; // documented exception, see above
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/inArray\(\s*mmaBatch\.status\s*,\s*\[([^\]]*)\]/g)) {
        offenders.push(`${f}: [${m[1]!.trim()}]`);
      }
    }
    expect(
      offenders,
      'filter with INFLIGHT_MMA_STATUS / TERMINAL_MMA_STATUS — a hand-written list is how `cancelled` was dropped from every cost total',
    ).toEqual([]);
  });
});
