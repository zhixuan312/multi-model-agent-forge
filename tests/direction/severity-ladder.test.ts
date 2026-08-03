// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEVERITY_ORDER } from '@/lib/severity';
import { SEVERITY_STYLE } from '@/components/patterns/findings';

/**
 * Severity is drawn in two places: the product's findings chip (`SEVERITY_STYLE`) and the
 * direction manual's reference ladder (`SEVERITY_VARIANT` in RouteBlock). They diverged —
 * the manual mapped `medium` to `neutral`, the same as `low`, so the page explaining
 * severity showed a four-tier ladder in three tints while the app showed four.
 *
 * Both must cover exactly `SEVERITY_ORDER`, and neither may collapse two tiers together.
 */
const ROOT = process.cwd();

function routeBlockLadder(): Record<string, string> {
  const src = readFileSync(join(ROOT, 'src/components/direction/RouteBlock.tsx'), 'utf8');
  const body = src.match(/const SEVERITY_VARIANT[^=]*=\s*\{([\s\S]*?)\};/)?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/(\w+):\s*'([\w-]+)'/g)].map((m) => [m[1]!, m[2]!]));
}

describe('severity ladders agree', () => {
  const manual = routeBlockLadder();

  it('read both ladders — a broken match must not pass vacuously', () => {
    expect(Object.keys(manual).sort()).toEqual([...SEVERITY_ORDER].sort());
    expect(Object.keys(SEVERITY_STYLE).sort()).toEqual([...SEVERITY_ORDER].sort());
  });

  it('gives every tier its own appearance in both', () => {
    expect(new Set(Object.values(manual)).size).toBe(SEVERITY_ORDER.length);
    expect(new Set(Object.values(SEVERITY_STYLE)).size).toBe(SEVERITY_ORDER.length);
  });

  it('keeps the two in the same order of intensity — rose, amber, steel, neutral', () => {
    expect(SEVERITY_ORDER.map((s) => manual[s])).toEqual(['rose', 'amber', 'steel', 'neutral']);
    // The product ladder uses the matching tints for the same tiers.
    expect(SEVERITY_STYLE.critical).toContain('rose');
    expect(SEVERITY_STYLE.high).toContain('amber');
    expect(SEVERITY_STYLE.medium).toContain('steel');
    expect(SEVERITY_STYLE.low).toContain('surface-2');
  });

  it('the manual renders one row per tier, driven by SEVERITY_ORDER', () => {
    const src = readFileSync(join(ROOT, 'src/components/direction/RouteBlock.tsx'), 'utf8');
    // Four hand-written <SeverityRow tier="…"> lines would drift the moment a tier is
    // added; the ladder is mapped from SEVERITY_ORDER instead.
    expect(src).toContain('SEVERITY_ORDER.map');
    expect(src).not.toMatch(/<SeverityRow tier="(critical|high|medium|low)"/);
  });
});
