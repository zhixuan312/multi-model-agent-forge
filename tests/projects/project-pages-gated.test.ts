// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every project surface must go through `requireProjectAccess`. The gate used to be
 * copied into each of them, so a NEW stage page could be added with the copy subtly
 * wrong — or missing — and nothing would say so.
 */
const ROOT = process.cwd();
const DIR = 'app/(app)/projects/[id]';

function surfaces(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      // `loading`/`error` render no project data, so they need no gate.
      else if (/\/(page|layout)\.tsx$/.test(rel)) out.push(rel);
    }
  };
  walk(DIR);
  return out;
}

describe('project surfaces are gated', () => {
  const files = surfaces();

  it('found the layout and every stage page', () => {
    expect(files).toContain(`${DIR}/layout.tsx`);
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it('every one CALLS requireProjectAccess, not merely imports it', () => {
    // Matching the bare name passed for a file that imported the gate and never called
    // it — which is exactly the regression this test exists to catch.
    const ungated = files.filter(
      (rel) => !/requireProjectAccess\s*\(/.test(readFileSync(join(ROOT, rel), 'utf8')),
    );
    expect(ungated, 'a project surface must not read anything before the gate').toEqual([]);
  });

  it('none of them re-implements the gate', () => {
    const offenders = files.filter((rel) => {
      const t = readFileSync(join(ROOT, rel), 'utf8');
      return /assertProjectReadable\s*\(/.test(t) || /projectActorFromMember\s*\(/.test(t);
    });
    expect(offenders, 'use requireProjectAccess instead of open-coding the gate').toEqual([]);
  });
});
