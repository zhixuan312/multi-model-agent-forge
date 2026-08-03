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
    .replace(/^\s*\/\/.*$/gm, '');
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
   * Union types were a blind spot. The first version of this test matched only the ARRAY
   * form (`['a', 'b', 'c']`), so `useState<'all' | 'recurring' | 'manual' | 'event'>` in
   * `LoopsClient` — a re-spelling of `LOOP_MODE` with one extra member — sailed past it.
   * A copy is a copy whichever punctuation it uses.
   */
  it('no file re-spells an enum as a type union', () => {
    const files = ['src', 'app'].flatMap((d) => (existsSync(join(ROOT, d)) ? sourceFiles(d) : []));
    const copies: string[] = [];
    for (const file of files) {
      if (file === ENUMS_FILE) continue;
      const code = codeOf(file);
      for (const [name, values] of enums) {
        const union = new RegExp(
          `'${values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(`'\\s*\\|\\s*'`)}'`,
        );
        if (union.test(code)) copies.push(`${file} re-spells ${name} as a union — use its exported type`);
      }
    }
    expect(copies).toEqual([]);
  });

  it('no file writes out a full enum the module already owns', () => {
    const files = ['src', 'app'].flatMap((d) => (existsSync(join(ROOT, d)) ? sourceFiles(d) : []));
    expect(files.length).toBeGreaterThan(100);

    const copies: string[] = [];
    for (const file of files) {
      if (file === ENUMS_FILE) continue;
      const code = codeOf(file);
      for (const [name, values] of enums) {
        const literal = new RegExp(
          `['"]${values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(`['"]\\s*,\\s*['"]`)}['"]`,
        );
        if (literal.test(code)) copies.push(`${file} writes out ${name} — import it instead`);
      }
    }
    expect(copies).toEqual([]);
  });
});
