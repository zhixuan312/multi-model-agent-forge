// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `var(--token)` a component reads must be a token that exists.
 *
 * A CSS custom property that was never declared does not fail loudly — the declaration
 * using it is simply invalid and drops, so the element renders with whatever it inherited.
 * Four had rotted in exactly that way, and each was invisible in review:
 *
 *   --rose-deep         StageAdvance's error text. `--sage-deep` exists, so `--rose-deep`
 *                       was assumed to. The advance-failed message was not red at all.
 *   --surface-elevated  the `skipped` stripe in StageRail — an invalid colour inside a
 *                       repeating-linear-gradient, so skipped segments had no background.
 *   --danger            four sites, each with a hardcoded `#c0492f` fallback, so the theme
 *                       was silently bypassed rather than broken. `--rose` is the token.
 *   --amber-tint-2      a hover that fell back to the base tint, i.e. no hover at all.
 */
const ROOT = process.cwd();

/** Supplied at runtime rather than declared in the stylesheet. */
const RUNTIME_PROVIDED = [
  /^--radix-/,        // Radix writes these onto its own portals
  /^--aside-w$/,      // Split sets it inline via `style`
];

/**
 * `.ts` as well as `.tsx`: class strings are not confined to components. The journal's
 * `palette.ts` maps a status to `text-steel-deep border-steel` and a write-log op to
 * `bg-ember-tint text-ember-deep`, and a .tsx-only sweep never looked at it — four of
 * those utilities emitted no CSS at all.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
  }
  return out;
}

describe('design tokens', () => {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
  const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
  const files = [...sourceFiles('src'), ...sourceFiles('app')];

  it('read the stylesheet and the components — neither check can pass vacuously', () => {
    expect(declared.size).toBeGreaterThan(30);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('.ts')), '.ts files must be in scope too').toBe(true);
  });

  it('every var(--token) referenced by a component is declared', () => {
    const missing: string[] = [];
    for (const rel of files) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const token = m[1]!;
        if (declared.has(token)) continue;
        if (RUNTIME_PROVIDED.some((re) => re.test(token))) continue;
        missing.push(`${token} (in ${rel})`);
      }
    }
    expect([...new Set(missing)], 'components read CSS variables that globals.css never declares').toEqual([]);
  });

  it('app chrome uses tokens, not raw hex colours', () => {
    // `bg-[#f0ede8]` on the Execute progress track was the outlier: every other progress bar
    // in the app uses `bg-surface-2`, so in the cool build palette — the phase Execute
    // actually runs in — that one track stayed warm beige while everything around it went
    // frost. JournalGraph3D is exempt: it is a 3D star-field with a deliberate bespoke
    // palette of its own (see graph-palette.ts), not themed app chrome.
    const EXEMPT = ['src/components/forge/journal/JournalGraph3D.tsx'];
    const offenders: string[] = [];
    for (const rel of files) {
      if (EXEMPT.some((e) => rel.endsWith(e))) continue;
      const text = readFileSync(join(ROOT, rel), 'utf8');
      for (const m of text.matchAll(/(?:bg|text|border|ring|fill|stroke|from|to|via)-\[(#[0-9a-fA-F]{3,8})\]/g)) {
        offenders.push(`${m[0]} (in ${rel})`);
      }
    }
    expect(offenders, 'use a design token instead of a raw hex').toEqual([]);
  });

  it('every Forge colour utility resolves to a token in the @theme block', () => {
    // A Tailwind utility like `text-sage-deep` needs `--color-sage-deep` in `@theme`. Without
    // it the class emits NO CSS and the element silently keeps whatever it inherited — the
    // same failure mode as an undeclared `var()`, and just as invisible. Three had rotted:
    // `text-sage-deep` (the raw `--sage-deep` existed but was never exposed), plus
    // `text-amber-deep` and `bg-surface-3`, which had no backing variable at all.
    const themed = new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
    // DERIVED, not hand-listed. The hand-list held 8 families and silently omitted `steel`
    // and `ember` — both fully declared as raw variables, neither exposed to `@theme`, so
    // every `text-steel-deep` / `bg-ember-tint` in the codebase went unscanned. Any family
    // the stylesheet names is a family this check must cover.
    const NON_COLOUR = new Set(['color', 'ease', 'font', 'r', 'radius', 'ring', 'shadow', 'tw', 'rail']);
    const families = [
      ...new Set(
        [...css.matchAll(/^\s*--([a-z0-9]+)(?:-[a-z0-9-]+)?\s*:/gm)]
          .map((m) => m[1]!)
          .filter((f) => !NON_COLOUR.has(f)),
      ),
    ];
    expect(families).toContain('steel');
    expect(families).toContain('ember');
    const FAMILIES = families.join('|');
    const utility = new RegExp(
      `(?<![\\w-])(?:bg|text|border|ring|fill|stroke|from|to|via|decoration|divide|outline|caret)-((?:${FAMILIES})(?:-[a-z0-9]+)*)(?![\\w[-])`,
      'g',
    );
    const offenders: string[] = [];
    for (const rel of files) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      for (const m of text.matchAll(utility)) {
        if (!themed.has(m[1]!)) offenders.push(`${m[0]} (in ${rel})`);
      }
    }
    expect([...new Set(offenders)], 'add the token to @theme, or use an existing one').toEqual([]);
  });

  it('the canvas hex mirror still matches the stylesheet it claims to mirror', () => {
    // `graph-palette.ts` mirrors token values as literals because a canvas cannot read CSS
    // vars, and its header asks a human to "keep in sync with app/globals.css". A comment
    // that requests synchronisation does not produce it. Each entry already names its token
    // in a trailing comment (`'#4e7350', // sage`), so that comment IS the assertion.
    const src = readFileSync(join(ROOT, 'src/components/forge/journal/graph-palette.ts'), 'utf8');
    // First declaration wins: the semantic tokens are defined once on `:root` (the warm
    // default the graph mirrors) and redefined under `[data-phase="build"]`. Values are
    // resolved through `var()` indirection — `--ink-soft: var(--warm-ink-soft)` is a hex,
    // just not a literal one.
    const decl = new Map<string, string>();
    for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
      if (!decl.has(m[1]!)) decl.set(m[1]!, m[2]!.trim());
    }
    const resolve = (token: string): string | undefined => {
      let v = decl.get(token);
      for (let hop = 0; hop < 5 && v?.startsWith('var('); hop++) {
        v = decl.get(v.slice(4, v.indexOf(')')).trim());
      }
      return v && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v.toLowerCase() : undefined;
    };
    const pairs = [...src.matchAll(/'(#[0-9a-fA-F]{3,8})',\s*\/\/\s*([a-z-]+)/g)];
    expect(pairs.length, 'no annotated hex entries found — the mirror or its comments moved').toBeGreaterThan(8);

    const drift: string[] = [];
    for (const m of pairs) {
      const [, hex, name] = m;
      const token = `--${name}`;
      const declared = resolve(token);
      if (declared === undefined) drift.push(`${token} does not resolve to a hex in globals.css`);
      else if (declared !== hex!.toLowerCase()) drift.push(`${token}: mirror has ${hex}, stylesheet has ${declared}`);
    }
    expect(drift, 'graph-palette.ts has drifted from globals.css').toEqual([]);
  });

  it('no component hardcodes a fallback hex behind a token', () => {
    // `var(--danger,#c0492f)` is worse than a missing token: it renders, so nothing looks
    // broken, while quietly opting that element out of the theme.
    const offenders: string[] = [];
    for (const rel of files) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      for (const m of text.matchAll(/var\(--[a-z0-9-]+\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g)) {
        offenders.push(`${m[0]} (in ${rel})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
