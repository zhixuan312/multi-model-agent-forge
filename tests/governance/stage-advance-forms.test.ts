// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `StageFlowPreview` declares the advance control's whole vocabulary and states the rule
 * outright: "a form that isn't in this list must not exist in a stage client", with the
 * padlock (`gate`) on exactly four advances — Plan→Execute, Execute→Review,
 * Review→Reflect, and "Mark complete".
 *
 * That was prose. This makes it a rule: the set of PRODUCTION components that gate a
 * stage advance must be exactly those four. A fifth gated advance, or one of these four
 * losing its padlock, now fails here instead of quietly changing what the catalog claims.
 */
const ROOT = process.cwd();

/** Production files (not previews/demos) that render `<StageAdvance …>`, and whether they gate it. */
function stageAdvanceUsage(): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!rel.endsWith('.tsx') || rel.includes('.test.')) continue;
      if (rel.includes('/governance/')) continue; // the catalog's own previews
      const text = readFileSync(join(ROOT, rel), 'utf8');
      for (const m of text.matchAll(/<StageAdvance\b([\s\S]*?)\/>/g)) {
        const props = m[1]!;
        const gated = /(^|\s)gate(\s|=|$)/.test(props);
        out.set(rel, (out.get(rel) ?? false) || gated);
      }
    }
  };
  walk('src');
  walk('app');
  return out;
}

const GATED = [
  'src/components/forge/PlanStageClient.tsx',    // Plan → Execute
  'src/components/forge/ExecuteStageClient.tsx', // Execute → Review
  'src/components/forge/ReviewStageClient.tsx',  // Review → Reflect
  'src/components/forge/SummaryPhase.tsx',       // Mark complete
];

describe('stage advance forms', () => {
  const usage = stageAdvanceUsage();

  it('found the stage clients — a broken walk must not pass vacuously', () => {
    expect(usage.size).toBeGreaterThanOrEqual(5);
    expect([...usage.keys()]).toContain('src/components/forge/SpecStageClient.tsx');
  });

  it('gates exactly the four advances the catalog names, and no others', () => {
    const gated = [...usage].filter(([, g]) => g).map(([f]) => f).sort();
    expect(gated).toEqual([...GATED].sort());
  });

  it('leaves the design-stage advances ungated — nothing irreversible is committed there', () => {
    for (const f of ['src/components/forge/ExploreStageClient.tsx', 'src/components/forge/SpecStageClient.tsx']) {
      expect(usage.get(f), f).toBe(false);
    }
  });
});
