// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * COMPATIBILITY.md is described in `matched-version.ts` as "the evidence behind this
 * version", and it carries a table of engine capabilities Forge "deliberately does NOT use".
 * Two rows were once false: `orchestrate` was claimed unused across ten dispatch sites, and
 * `sessionIds` was claimed unused after the loop began resuming its main session. A table
 * nobody checks becomes a table nobody can trust.
 *
 * This file used to check a HARD-CODED list of three identifiers against a six-row table,
 * each guarded by `if (!section.includes(id)) return;` — so when the `sessionIds` row was
 * (correctly) removed, that case silently became a no-op, and four rows had no check at all.
 * A checker narrower than the claim it guards is the same failure as no checker, arriving
 * later.
 *
 * Now the ROWS drive the test. Every row must be accounted for: either it names an
 * identifier whose absence from the source proves the claim, or it is listed as
 * unverifiable with the reason. A new row fails until someone decides which.
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

/** The Capability cell of every row in the "deliberately does NOT use" table. */
function capabilityRows(section: string): string[] {
  return section
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && l.includes('|'))
    .map((l) => l.split('|')[1]?.trim() ?? '')
    .filter((c) => c && c !== 'Capability' && !/^-+$/.test(c));
}

/**
 * Row → the identifier whose ABSENCE from `src`/`app` proves the row's claim, or `null`
 * when the claim is about a shape no single token captures. Keyed by a distinctive
 * substring of the Capability cell so wording tweaks do not silently unkey a row.
 */
const PROOF: ReadonlyArray<{ match: string; identifier: string | null; why?: string }> = [
  { match: 'agentTier', identifier: 'agentTier' },
  { match: 'reviewerNote', identifier: 'reviewerNote' },
  { match: '`debug` task type', identifier: 'debug-route' },
  { match: 'fieldErrors', identifier: 'fieldErrors' },
  { match: 'context-blocks', identifier: 'context-blocks' },
  {
    match: 'GET /status',
    identifier: null,
    // The claim is "reads only these four fields", which is a shape, not a token. `inflight`
    // matches Forge's own unrelated local in dispatch-helpers, so a bare identifier search
    // here would report a violation that is not one — a false alarm trains people to ignore
    // the check, which costs more than the row being unverified.
    why: 'a narrowing claim about which response fields are read, not the presence of a name',
  },
];

describe('the "deliberately not used" table tells the truth', () => {
  const doc = readFileSync(join(ROOT, DOC), 'utf8');
  const section = (doc.split('deliberately does NOT use')[1] ?? '').split('\n## ')[0] ?? '';
  const rows = capabilityRows(section);
  const code = [...sources('src'), ...sources('app')]
    .filter((f) => !f.startsWith('src/content/'))       // prose about the engine, not calls
    .map((f) => ({ f, text: readFileSync(join(ROOT, f), 'utf8') }));

  it('found the section, the rows, and a real source set', () => {
    expect(section.length).toBeGreaterThan(200);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(code.length).toBeGreaterThan(100);
  });

  /** The point of the rewrite: a new row cannot arrive unchecked. */
  it('every row is either proven or explicitly unverifiable', () => {
    const orphans = rows.filter((r) => !PROOF.some((p) => r.includes(p.match)));
    expect(
      orphans,
      'add the row to PROOF with the identifier that proves it, or with why it cannot be checked',
    ).toEqual([]);
  });

  /** And a PROOF entry for a row that no longer exists is a check guarding nothing. */
  it('has no proof entry for a row that is gone', () => {
    const stale = PROOF.filter((p) => !rows.some((r) => r.includes(p.match))).map((p) => p.match);
    expect(stale, 'the row was removed — drop its entry rather than leaving a silent no-op').toEqual([]);
  });

  it.each(PROOF.filter((p) => p.identifier))(
    'the source does not use "$identifier", which the table claims Forge skips',
    ({ identifier }) => {
      // The `debug` row is about DISPATCH, so it is matched as a route/type literal — the
      // bare word "debug" appears legitimately all over any codebase.
      const re =
        identifier === 'debug-route'
          ? /route: 'debug'|type: 'debug'/
          : new RegExp(`\\b${identifier!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      const users = code.filter((c) => re.test(c.text)).map((u) => u.f);
      expect(users, `the table says Forge skips this, but it appears in the source`).toEqual([]);
    },
  );

  /**
   * A bare identifier match, not `field:`. The first version looked for `sessionIds:` and
   * missed `body.sessionIds = {...}` — the exact assignment the loop adapter uses — so a
   * reinstated false claim passed under sabotage.
   */
  it('matches bare identifiers, so an assignment form cannot slip past', () => {
    const probe = 'const x = {}; x.agentTier = 1;';
    expect(/\bagentTier\b/.test(probe)).toBe(true);
  });
});
