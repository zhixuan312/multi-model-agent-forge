// @vitest-environment node
/**
 * `db/enums.ts` states the convention in its own header: enums live in code, "columns
 * reference these arrays via Drizzle `text({ enum: X })`" and "Zod schemas derive via
 * `z.enum(X)`". Four places did neither and wrote the values out again:
 *
 *   - `app/(app)/loops/activity/page.tsx` — the `?status=` validator, while the filter
 *     dropdown beside it derived from the enum. A new status would have appeared in the
 *     dropdown, been rejected by the validator, and returned unfiltered results;
 *   - `src/db/schema/build.ts` — a `text('format', { enum: [...] })` column beside
 *     `EXPORT_FORMAT`;
 *   - `src/details/schema.ts` — `stageStatus` AND `phaseStatus`, so `STAGE_STATUS`
 *     existed in three places, plus `auditPassStatus` duplicating `AUDIT_VERDICT`.
 *
 * A copy is only a problem when someone adds a value, which is exactly when nobody is
 * looking for one. Derived from `enums.ts` itself, so this covers every enum in it —
 * including ones added later.
 *
 * ## Two things this checks that it once didn't
 *
 * **Order.** The first two versions pasted the enum's values into a regex IN ITS DECLARED
 * ORDER, so a copy that listed the same values differently was invisible. `projects-core.ts`
 * and `app/api/projects/[id]/route.ts` both had `z.enum(['public', 'private'])` next to a
 * `PROJECT_VISIBILITY` declared `['private', 'public']`, and this test read them as unrelated.
 * The union check's own comment already had the principle — "a copy is a copy whichever
 * punctuation it uses" — and order is just more punctuation. Values are now compared as SETS.
 *
 * **One extra member.** Set EQUALITY alone would have been a downgrade: the union check was
 * a substring match, which is how it caught `'all' | 'recurring' | 'manual' | 'event'` in
 * `LoopsClient` — `LOOP_MODE` plus a UI-only sentinel. That shape is the common one (an
 * enum plus `'all'`), and it is still a copy of the enum. So the rule is **superset within
 * one**: flag a list that contains every value of an enum and has at most one value beyond
 * it. A strict SUBSET is left alone — `attemptStatus` is `MMA_STATUS` minus `dispatched`,
 * a deliberate narrowing that should keep compiling on its own.
 *
 * The extra-member tolerance needs THREE known values to stand on, though. `LOOP_WORKER_TIER`
 * is `['standard', 'complex']` — the two tiers a loop may dispatch to, a deliberate 2-of-3
 * narrowing of MMA's tiers ("`main` is the orchestrator, never a worker", says its own doc).
 * With the tolerance applied at two, every `'main' | 'complex' | 'standard'` in the codebase
 * came back as a copy of it, which inverts the relationship: the tier triple is the wider
 * concept, and the enum is the subset. Two shared values are too weak a signal to call it.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ENUMS_FILE = 'src/db/enums.ts';

/** Every `export const X = ['a', 'b', …] as const` in enums.ts, with its values. */
function enumsUnderTest(): Map<string, string[]> {
  const src = readFileSync(join(ROOT, ENUMS_FILE), 'utf8');
  const out = new Map<string, string[]>();
  for (const m of src.matchAll(/^export const ([A-Z][A-Z0-9_]*) = \[([^\]]*)\] as const;/gm)) {
    const values = [...m[2]!.matchAll(/'([^']+)'/g)].map((v) => v[1]!);
    // A single-value enum ('maintenance') is too short to match distinctively.
    if (values.length >= 2) out.set(m[1]!, values);
  }
  return out;
}

/**
 * Comments are stripped first. Several of these fixes EXPLAIN themselves by quoting the
 * list they replaced, and prose naming a value set is documentation worth keeping — it is
 * the executable copy that must be single-source.
 */
function codeOf(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Both whole-line AND trailing `//` comments. `audit-loop-policy.ts` documents the
    // shape it accepts with a trailing `// 'clean' | 'revised' | …`, which is prose doing
    // its job. The leading-space requirement keeps `https://` out of it.
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

const LITERAL = `['"][^'"]*['"]`;

/** Every array of 2+ string literals: `['a', 'b']`, `z.enum(['a', 'b'])`, `{ enum: [...] }`. */
export function literalArrays(code: string): string[][] {
  const re = new RegExp(`\\[\\s*(${LITERAL}(?:\\s*,\\s*${LITERAL})+)\\s*,?\\s*\\]`, 'g');
  return [...code.matchAll(re)].map((m) => [...m[1]!.matchAll(/['"]([^'"]*)['"]/g)].map((v) => v[1]!));
}

/** Every union of 2+ string literals: `'a' | 'b'`, however it is wrapped or line-broken. */
export function literalUnions(code: string): string[][] {
  const re = new RegExp(`${LITERAL}(?:\\s*\\|\\s*${LITERAL})+`, 'g');
  return [...code.matchAll(re)].map((m) => [...m[0].matchAll(/['"]([^'"]*)['"]/g)].map((v) => v[1]!));
}

/**
 * Is `candidate` a copy of `values`? Order-independent, and tolerant of exactly one extra
 * member so the `enum + 'all'` sentinel shape is still caught. Anything wider than that is
 * some other list that happens to contain these values, and flagging it would be noise.
 */
export function isCopyOf(candidate: string[], values: string[]): boolean {
  const slack = values.length >= 3 ? 1 : 0;
  if (candidate.length < values.length || candidate.length > values.length + slack) return false;
  const have = new Set(candidate);
  return values.every((v) => have.has(v));
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.name === 'node_modules' || e.name.startsWith('.next')) continue;
    if (e.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
  }
  return out;
}

describe('db enums are single-source', () => {
  const enums = enumsUnderTest();

  it('found the enum module and its value sets', () => {
    expect(enums.size).toBeGreaterThan(10);
    expect(enums.get('STAGE_STATUS')).toEqual(['pending', 'active', 'done', 'skipped']);
  });

  /**
   * The detector, against planted copies of the exact shapes that have slipped through —
   * so a future rewrite of the matching cannot quietly stop catching them. Each of the
   * first four is a real bug this file failed to see at some point.
   */
  describe('the detector itself', () => {
    const S = ['pending', 'active', 'done'];

    it('catches an array copy, in any order', () => {
      expect(literalArrays(`z.enum(['pending', 'active', 'done'])`).some((c) => isCopyOf(c, S))).toBe(true);
      expect(literalArrays(`z.enum(['done', 'pending', 'active'])`).some((c) => isCopyOf(c, S))).toBe(true);
      expect(literalArrays(`text('s', { enum: ['active', 'done', 'pending'] })`).some((c) => isCopyOf(c, S))).toBe(true);
    });

    it('catches a union copy, in any order and however line-broken', () => {
      expect(literalUnions(`type X = 'pending' | 'active' | 'done';`).some((c) => isCopyOf(c, S))).toBe(true);
      expect(literalUnions(`type X = 'done' | 'pending' | 'active';`).some((c) => isCopyOf(c, S))).toBe(true);
      expect(literalUnions("type X =\n  | 'pending'\n  | 'active'\n  | 'done';").some((c) => isCopyOf(c, S))).toBe(true);
    });

    it('catches the enum-plus-a-sentinel shape', () => {
      expect(literalUnions(`useState<'all' | 'pending' | 'active' | 'done'>`).some((c) => isCopyOf(c, S))).toBe(true);
    });

    it('leaves a deliberate narrowing alone', () => {
      expect(literalArrays(`z.enum(['pending', 'active'])`).some((c) => isCopyOf(c, S))).toBe(false);
    });

    it('does not extend the sentinel tolerance to a two-value enum', () => {
      // `['standard', 'complex']` is LOOP_WORKER_TIER; `['main', 'complex', 'standard']` is
      // the tier triple it narrows. Two overlapping values do not make the wider set a copy.
      expect(literalArrays(`['main', 'complex', 'standard']`).some((c) => isCopyOf(c, ['standard', 'complex']))).toBe(false);
    });

    it('leaves an unrelated long list alone even when it contains the values', () => {
      const wide = `['pending', 'active', 'done', 'x', 'y', 'z']`;
      expect(literalArrays(wide).some((c) => isCopyOf(c, S))).toBe(false);
    });
  });

  it('no file writes out an enum the module already owns', () => {
    const files = ['src', 'app'].flatMap((d) => (existsSync(join(ROOT, d)) ? sourceFiles(d) : []));
    expect(files.length).toBeGreaterThan(100);

    const copies: string[] = [];
    for (const file of files) {
      if (file === ENUMS_FILE) continue;
      const code = codeOf(file);
      const candidates = [
        ...literalArrays(code).map((c) => ({ c, how: 'writes out' })),
        ...literalUnions(code).map((c) => ({ c, how: 're-spells' })),
      ];
      for (const [name, values] of enums) {
        for (const { c, how } of candidates) {
          if (isCopyOf(c, values)) {
            copies.push(`${file} ${how} ${name} — import it instead`);
            break;
          }
        }
      }
    }
    expect(copies).toEqual([]);
  });
});
