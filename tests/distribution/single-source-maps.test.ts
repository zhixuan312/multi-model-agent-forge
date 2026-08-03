// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEARNING_CATEGORIES } from '@/journal/types';

/**
 * A taxonomy must be styled in exactly one place.
 *
 * The journal's category tints were extracted into `category-style.tsx` after existing
 * three times — and a FOURTH copy survived in the governance right-panel preview, spelled
 * with capitalised keys so no search for the real ones found it. That copy had drifted:
 * four of six categories showed the wrong colour, in the very surface whose job is to
 * demonstrate the design system.
 *
 * This catches the shape rather than the instance: any object literal keyed by the
 * learning categories, anywhere but the module that owns them.
 */
const ROOT = process.cwd();
const OWNER = 'src/components/forge/journal/category-style.tsx';

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

describe('single-source taxonomy styling', () => {
  const files = [...sourceFiles('src'), ...sourceFiles('app')];

  it('scanned a real file set and knows where the owner lives', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(OWNER);
    expect(LEARNING_CATEGORIES.length).toBeGreaterThan(3);
  });

  it('no file but the owner maps the learning categories to styles', () => {
    // Three distinct categories as adjacent object keys is the signature of a rival map;
    // prose or a single mention is not.
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel === OWNER) continue;
      const text = readFileSync(join(ROOT, rel), 'utf8');
      const hits = LEARNING_CATEGORIES.filter((c) =>
        new RegExp(`^\\s*['"]?${c}['"]?\\s*:`, 'im').test(text),
      );
      if (hits.length >= 3) offenders.push(`${rel} (keys: ${hits.join(', ')})`);
    }
    expect(offenders, 'style the categories via categoryStyle/CategoryChip, not a second map').toEqual([]);
  });
});
