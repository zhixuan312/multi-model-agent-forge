// @vitest-environment node
/**
 * A chooser must not hand-list an enum it could derive.
 *
 * `enum-single-source.test.ts` finds an enum re-spelled as an array or a union. It cannot
 * find one re-spelled as UI options — `[{ value: 'recurring', label: 'Recurring' }, …]` —
 * because the literal array it extracts is twice the enum's length, so it fails the
 * superset-within-one test that keeps it from crying wolf.
 *
 * Two choosers were hiding in that gap. `LoopForm`'s mode selector sat under a comment
 * recording that a local `LoopMode` union had been removed "so a new mode would have compiled
 * here while the form silently offered three" — with the options still literal, which is the
 * half that produces exactly that. `ModelsPanel`'s protocol selector was the third spelling
 * of `Dialect`, alongside the type and the route's `z.enum`.
 *
 * The failure mode is always the same and always quiet: add a value to the enum, everything
 * type-checks, and the new option simply never appears. Nobody sees an error — they see a
 * form that looks finished.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every `export const X = [...] as const` across the modules that own a value set. */
function enums(): Map<string, string[]> {
  const FILES = [
    'src/db/enums.ts',
    'src/mma/tiers.ts',
    'src/mma/configure-provider.ts',
    'src/export/types.ts',
    'src/projects/design-stages.ts',
  ];
  const out = new Map<string, string[]>();
  for (const f of FILES) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^export const ([A-Z][A-Z0-9_]*) = \[([^\]]*)\] as const/gm)) {
      const values = [...m[2]!.matchAll(/'([^']+)'/g)].map((v) => v[1]!);
      if (values.length >= 2) out.set(m[1]!, values);
    }
  }
  return out;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.next')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(p);
  }
  return out;
}

/** The `value:` literals of every hand-written `{ value, label }` option group. */
export function optionValueGroups(code: string): string[][] {
  const groups: string[][] = [];
  // `options={[ … ]}` / `options: [ … ]` — take the whole bracketed run, then its `value:`s.
  for (const m of code.matchAll(/options\s*[=:]\s*\{?\[([\s\S]{0,600}?)\]\}?/g)) {
    const values = [...m[1]!.matchAll(/value:\s*'([^']+)'/g)].map((v) => v[1]!);
    if (values.length >= 2) groups.push(values);
  }
  return groups;
}

/** The `value="…"` literals of consecutive `<SelectItem>` / `<option>` elements. */
export function selectItemGroups(code: string): string[][] {
  const groups: string[][] = [];
  let run: string[] = [];
  for (const line of code.split('\n')) {
    const m = /<(?:SelectItem|option)\s+[^>]*value=["']([^"']+)["']/.exec(line);
    if (m) run.push(m[1]!);
    else if (!/^\s*(\{|\}|\)|>|\/>)\s*$/.test(line)) {
      if (run.length >= 2) groups.push(run);
      run = [];
    }
  }
  if (run.length >= 2) groups.push(run);
  return groups;
}

/**
 * Does this option group re-spell `values`? Same rule as the enum ratchet: the group must
 * contain every enum value, with at most one extra — the `'all'` / `'__all'` sentinel a
 * filter adds. A group that is merely a subset is a deliberate narrowing and stays legal.
 */
function isEnumList(group: string[], values: string[]): boolean {
  if (values.length < 2) return false;
  if (group.length < values.length || group.length > values.length + 1) return false;
  const have = new Set(group);
  return values.every((v) => have.has(v));
}

describe('no chooser hand-lists an enum', () => {
  const ENUMS = enums();
  const files = [...sourceFiles('app'), ...sourceFiles('src')];

  it('found the enums and the components', () => {
    expect(ENUMS.size).toBeGreaterThan(15);
    expect(ENUMS.get('LOOP_MODE')).toEqual(['recurring', 'manual', 'event']);
    expect(files.length).toBeGreaterThan(200);
  });

  describe('the detector', () => {
    it('catches an options array', () => {
      const code = `options={[{ value: 'recurring', label: 'Recurring' }, { value: 'manual', label: 'Manual' }, { value: 'event', label: 'Event' }]}`;
      expect(optionValueGroups(code).some((g) => isEnumList(g, ['recurring', 'manual', 'event']))).toBe(true);
    });

    it('catches a run of SelectItems, sentinel included', () => {
      const code = [
        `<SelectItem value="all">All</SelectItem>`,
        `<SelectItem value="recurring">Recurring</SelectItem>`,
        `<SelectItem value="manual">Manual</SelectItem>`,
        `<SelectItem value="event">Event</SelectItem>`,
      ].join('\n');
      expect(selectItemGroups(code).some((g) => isEnumList(g, ['recurring', 'manual', 'event']))).toBe(true);
    });

    it('leaves a deliberate narrowing alone', () => {
      const code = `options={[{ value: 'recurring', label: 'R' }, { value: 'manual', label: 'M' }]}`;
      expect(optionValueGroups(code).some((g) => isEnumList(g, ['recurring', 'manual', 'event']))).toBe(false);
    });

    it('leaves a derived list alone — there are no literals to find', () => {
      const code = `options={LOOP_MODE.map((m) => ({ value: m, label: MODE_LABEL[m] }))}`;
      expect(optionValueGroups(code)).toEqual([]);
    });
  });

  it('every chooser derives its options from the enum', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      const groups = [...optionValueGroups(code), ...selectItemGroups(code)];
      for (const [name, values] of ENUMS) {
        if (groups.some((g) => isEnumList(g, values))) {
          offenders.push(`${f} hand-lists ${name} as options — map over the enum with a total label record`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
