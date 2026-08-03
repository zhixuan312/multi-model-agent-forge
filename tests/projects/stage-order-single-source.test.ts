// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAGE_KIND, STAGE_ORDER } from '@/db/enums';

/**
 * The six stage kinds, in order, were written out as a literal in FIVE places besides
 * `db/enums`: the project layout twice, `project-summary`, `projects-core` twice, and a
 * local `const STAGE_ORDER` in `SummaryPhase` that shadowed the identically-named export.
 * Adding or reordering a stage meant finding all of them.
 */
const ROOT = process.cwd();
const LITERAL = /'exploration',\s*'spec',\s*'plan',\s*'execute',\s*'review',\s*'journal'/;

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

describe('stage order has one source', () => {
  it('STAGE_ORDER is STAGE_KIND, not a second tuple', () => {
    expect(STAGE_ORDER).toBe(STAGE_KIND);
    expect(STAGE_KIND).toHaveLength(6);
  });

  it('no file spells the stage tuple out except the enum that owns it', () => {
    const offenders = [...sourceFiles('src'), ...sourceFiles('app')]
      .filter((rel) => rel !== 'src/db/enums.ts')
      .filter((rel) => LITERAL.test(readFileSync(join(ROOT, rel), 'utf8')));
    expect(offenders, 'import STAGE_KIND / STAGE_ORDER instead').toEqual([]);
  });
});
