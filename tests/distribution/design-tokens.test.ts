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

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...tsxFiles(rel));
    else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
  }
  return out;
}

describe('design tokens', () => {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
  const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
  const files = [...tsxFiles('src'), ...tsxFiles('app')];

  it('read the stylesheet and the components — neither check can pass vacuously', () => {
    expect(declared.size).toBeGreaterThan(30);
    expect(files.length).toBeGreaterThan(100);
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
