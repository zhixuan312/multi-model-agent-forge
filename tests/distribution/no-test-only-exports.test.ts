// @vitest-environment node
/**
 * A test is not a caller.
 *
 * `ProjectTopbar.test.tsx` says it outright: three of its cases exercised states the layout
 * cannot produce, and "they were the only thing keeping that code alive". Two more had the
 * same shape and nothing found them —
 *
 *   - `FindingCard`, a pre-table rendering of a finding, superseded when `FindingsGrid`
 *     moved to `FindingTableRow`. Declared, never rendered by anything.
 *   - `ConversationPane`, a composed message-list-plus-composer. The three stage clients
 *     import `ConversationComposer` and build their own panes; none used this.
 *
 * Both compiled, both had passing tests, and both were dead. That is the worst shape dormant
 * code takes: the test reads as evidence the thing is in use.
 *
 * This is the sweep that found them. It flags an export with NO reference outside its own
 * declaration anywhere in the shipped tree, that tests do reference. A seam deliberately
 * exposed for testing is legitimate and stays — by being named below, with why.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/**
 * Exports with no production caller that are allowed to exist, each with its reason.
 * Adding a name here is a claim someone can check; the alternative — a silent skip — is
 * how the two above survived.
 */
const DELIBERATE_SEAMS: Record<string, string> = {
  // The log sink is swappable precisely so a test can observe structured events; the
  // instrumentation docstring records that its absence was the defect.
  setLogSink: 'the injection point that makes logEvent observable',
  // A named alias over a private helper, so the notification metadata can be asserted
  // without exporting the internal itself.
  notificationMetaForTest: 'exposes handlerMeta for assertion without widening the module',
  // The liveness anchors: rule constant → the component that must still contain it. Read
  // only by `conformance.test.ts`, which is the point — it is a table of claims to verify.
  SIGNATURE_SOURCES: 'signature→source anchors, verified by conformance.test.ts',
};

/** Files the FRAMEWORK loads directly — a caller this scan cannot see. */
const ROOT_ENTRIES = ['middleware.ts', 'instrumentation.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
  }
  return out;
}

const shipped = [...walk('src'), ...walk('app'), ...ROOT_ENTRIES].map((f) => ({
  f,
  t: readFileSync(join(ROOT, f), 'utf8'),
}));

const testText = (function collect(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) collect(rel, acc);
    else if (/\.test\.tsx?$/.test(e.name)) acc.push(readFileSync(join(ROOT, rel), 'utf8'));
  }
  return acc;
})('tests').join('\n');

/**
 * Next reads these off a route module by name; there is no code reference to find.
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
 */
const ROUTE_SEGMENT_CONFIG = new Set([
  'runtime', 'dynamic', 'revalidate', 'fetchCache', 'maxDuration', 'preferredRegion', 'metadata',
]);

describe('no export is kept alive only by its test', () => {
  const orphans: string[] = [];
  for (const { f, t } of shipped) {
    for (const m of t.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)) {
      const name = m[1]!;
      if (name.length < 4 || ROUTE_SEGMENT_CONFIG.has(name)) continue;
      // Global regex — a non-global one returns only the first match and makes every
      // export look single-use. That bug made the first run of this sweep report 106
      // false positives.
      const g = new RegExp(`\\b${name}\\b`, 'g');
      if ((t.match(g) ?? []).length > 1) continue;                      // used in its own file
      if (shipped.some((o) => o.f !== f && g.test(o.t))) continue;      // used elsewhere
      if (!new RegExp(`\\b${name}\\b`).test(testText)) continue;        // not a test-only case
      if (name in DELIBERATE_SEAMS) continue;
      orphans.push(`${f} :: ${name}`);
    }
  }

  it('scanned a real tree — an empty walk must not pass vacuously', () => {
    expect(shipped.length).toBeGreaterThan(300);
    expect(testText.length).toBeGreaterThan(100_000);
  });

  it('has no production export whose only consumer is a test', () => {
    expect(
      orphans,
      'delete it, wire it up, or add it to DELIBERATE_SEAMS with the reason it exists',
    ).toEqual([]);
  });

  it('has no stale seam entry for an export that is gone', () => {
    const declared = new Set(
      shipped.flatMap(({ t }) => [...t.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map((m) => m[1]!)),
    );
    expect(Object.keys(DELIBERATE_SEAMS).filter((n) => !declared.has(n))).toEqual([]);
  });
});
