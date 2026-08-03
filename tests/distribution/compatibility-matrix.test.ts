// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * COMPATIBILITY.md is described in `matched-version.ts` as "the evidence behind this
 * version", and it carries a table of engine capabilities Forge "deliberately does NOT
 * use". Two of its rows were false: `orchestrate` was claimed unused across ten dispatch
 * sites, and `sessionIds` was claimed unused after the loop began resuming its main
 * session. A table nobody checks becomes a table nobody can trust.
 *
 * Only the mechanically checkable rows are pinned here — a capability whose use shows up
 * as a literal in a dispatch body.
 */
const ROOT = process.cwd();
const DOC = 'src/mma/COMPATIBILITY.md';

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return sources(rel);
    return /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [rel] : [];
  });
}

describe('the "deliberately not used" table tells the truth', () => {
  const doc = readFileSync(join(ROOT, DOC), 'utf8');
  const unusedSection = doc.split('deliberately does NOT use')[1] ?? '';
  const code = [...sources('src'), ...sources('app')]
    .filter((f) => !f.startsWith('src/content/'))       // prose about the engine, not calls
    .map((f) => ({ f, text: readFileSync(join(ROOT, f), 'utf8') }));

  it('found the section and a real source set', () => {
    expect(unusedSection.length).toBeGreaterThan(200);
    expect(code.length).toBeGreaterThan(100);
  });

  /** A task type listed as unused must not be dispatched. */
  it.each(['debug'])('does not dispatch the "%s" task type it claims to skip', (type) => {
    if (!unusedSection.includes(`\`${type}\` task type`)) return; // row gone → nothing to check
    const users = code.filter((c) => new RegExp(`route: '${type}'|type: '${type}'`).test(c.text));
    expect(users.map((u) => u.f), `${type} is listed as unused but dispatched`).toEqual([]);
  });

  /**
   * A request field listed as unused must not appear in the source at all.
   *
   * Deliberately a BARE identifier match, not `field:`. The first version looked for
   * `sessionIds:` and missed `body.sessionIds = {...}` — the exact assignment the loop
   * adapter uses — so a reinstated false claim passed under sabotage. The field names are
   * distinctive enough that any mention is worth a human look.
   */
  it.each(['agentTier', 'sessionIds'])('does not use the "%s" field it claims to skip', (field) => {
    if (!unusedSection.includes(`\`${field}\``)) return; // row gone → nothing to check
    const users = code.filter((c) => new RegExp(`\\b${field}\\b`).test(c.text));
    expect(users.map((u) => u.f), `${field} is listed as unused but appears in the source`).toEqual([]);
  });
});
