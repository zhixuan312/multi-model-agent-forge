// @vitest-environment node
/**
 * The ESLint rule and the conformance checker enforce the SAME signature.
 *
 * They each held their own copy. When `status-dashboard.tsx` stopped emitting
 * `lg:items-stretch`, `conformance.ts` was corrected — its own docstring records the fix —
 * and `no-ungoverned-structure.mjs` was not. So the lint rule guarded a class string that
 * appeared in no file in the repository, could never fire, reported a permanently clean
 * layer, and would have let a page hand-rolling the CURRENT grid straight through. It ran on
 * every `pnpm lint`, including the release gate, the whole time.
 *
 * A signature rule dies silently: nothing about an assertion that never matches looks
 * different from one that always passes. So the signature now lives in one JSON file that
 * both consumers read, and the tests below check it still matches the component it was
 * copied from — the only thing that can tell a live rule from a dead one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DASHBOARD_GRID_RE, RAIL_NOTE_SIGNATURE } from '@/governance/conformance';
import SIGNATURES from '../../eslint-rules/governed-components/signatures.json';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('governed-layout signature', () => {
  it('the ESLint rule reads the shared file rather than a literal of its own', () => {
    const rule = read('eslint-rules/governed-components/no-ungoverned-structure.mjs');
    expect(rule).toContain("readFileSync(join(__dirname, 'signatures.json')");
    expect(rule, 'a hard-coded class string here is how the two drifted apart')
      .not.toMatch(/const PATTERN = ['"]grid /);
  });

  it('the conformance checker reads the same file', () => {
    const conf = read('src/governance/conformance.ts');
    expect(conf).toContain('signatures.json');
    expect(conf).not.toMatch(/DASHBOARD_GRID_RE = \/grid /);
  });

  /**
   * The load-bearing assertion. A signature that matches nothing is indistinguishable from
   * a clean repo — this is what proves the rule can still fire.
   */
  it('the signature still matches the component it governs', () => {
    const canonical = read(SIGNATURES.canonical);
    expect(canonical, `${SIGNATURES.canonical} no longer contains the governed grid — the rule is dead`)
      .toContain(SIGNATURES.dashboardGrid);
    expect(DASHBOARD_GRID_RE.test(canonical)).toBe(true);
  });

  it('names the file that really owns the grid', () => {
    // The rule exempted `stage-shell.tsx`, which does not contain the grid at all — so the
    // one file allowed to hold it was not the file holding it.
    expect(SIGNATURES.canonical).toBe('src/components/patterns/status-dashboard.tsx');
  });

  it('the rail-note signature still matches RailNote', () => {
    expect(read('src/components/patterns/feature-rail.tsx')).toContain(RAIL_NOTE_SIGNATURE);
  });

  /** Pinned to the utilities that MAKE it that grid — a cosmetic addition must not disarm it. */
  it('does not pin utilities the component may legitimately drop', () => {
    expect(SIGNATURES.dashboardGrid).not.toContain('items-stretch');
    expect(SIGNATURES.dashboardGrid).not.toContain('grid-rows');
  });
});
