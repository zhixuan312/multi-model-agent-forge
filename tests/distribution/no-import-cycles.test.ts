// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

/**
 * The shipped module graph has no static import cycles.
 *
 * Three existed when this was first run, and all three had the same shape: a value the
 * product needs sitting in a module that also pulls in heavy component wiring.
 *
 *   AutomationGate → AutomationOverlay → AutomationGate
 *   AutomationBar → AutomationGate → AutomationOverlay → AutomationBar
 *     `automationOverlayStore` — shared state — lived INSIDE `AutomationGate.tsx`, so two
 *     sibling components imported it from the component that renders them.
 *
 *   Sidebar → governance/registry → AppShellPreview → Sidebar
 *     `Sidebar` wanted one plain-data export; `registry.tsx` statically imports all five
 *     preview component trees to attach `renderPreview` closures, so the product's left
 *     rail transitively pulled the whole dev-only preview surface back into itself.
 *
 * None of them broke anything: every reference is read at RENDER time, never during module
 * init, so the partially-initialised binding is always populated by the time it is read.
 * That is exactly what makes them worth removing — **a benign cycle is a latent one.** The
 * day someone hoists one of those reads to module scope, they get `undefined` with no
 * local explanation, and the cause is three files away.
 *
 * DYNAMIC `import()` is deliberately not an edge here. It is this repo's documented way of
 * breaking a cycle (`details-actions.ts` does it for the driver, `AppShellPreview` now does
 * it for `Sidebar`), and it is a real chunk boundary to the bundler too.
 *
 * Type-only imports are likewise skipped: `import type` erases at compile time and cannot
 * participate in an initialisation order problem.
 */
const ROOT = process.cwd();
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = resolve(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(ROOT, dirname(fromFile), spec);
  else return null;
  for (const ext of EXTS) {
    const c = base + ext;
    if (existsSync(c) && statSync(c).isFile()) return relative(ROOT, c);
  }
  return existsSync(base) && statSync(base).isFile() ? relative(ROOT, base) : null;
}

/** Every static (value) import edge in the shipped tree. */
export function buildGraph(files: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const deps = new Set<string>();
    for (const m of src.matchAll(/^\s*import\s+(?:type\s+)?[^;']*from\s+'([^']+)'/gm)) {
      if (/^\s*import\s+type\s/.test(m[0])) continue;
      const t = resolveSpec(m[1]!, f);
      if (t) deps.add(t);
    }
    for (const m of src.matchAll(/^\s*export\s+\*\s+from\s+'([^']+)'/gm)) {
      const t = resolveSpec(m[1]!, f);
      if (t) deps.add(t);
    }
    graph.set(f, [...deps]);
  }
  return graph;
}

export function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, number>();
  const dfs = (n: string, stack: string[]): void => {
    state.set(n, 1);
    stack.push(n);
    for (const d of graph.get(n) ?? []) {
      if (!graph.has(d)) continue;
      if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d]);
      else if (!state.get(d)) dfs(d, stack);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const f of graph.keys()) if (!state.get(f)) dfs(f, []);
  return [...new Map(cycles.map((c) => [[...c].sort().join('|'), c])).values()];
}

describe('the cycle detector itself', () => {
  // A detector that silently finds nothing is indistinguishable from a clean graph — the
  // failure mode that made two earlier sweeps in this audit report false all-clears.
  it('reports a cycle when one exists', () => {
    const g = new Map<string, string[]>([
      ['a.ts', ['b.ts']],
      ['b.ts', ['c.ts']],
      ['c.ts', ['a.ts']],
    ]);
    expect(findCycles(g)).toHaveLength(1);
  });

  it('does not invent one for a diamond, which is not a cycle', () => {
    const g = new Map<string, string[]>([
      ['a.ts', ['b.ts', 'c.ts']],
      ['b.ts', ['d.ts']],
      ['c.ts', ['d.ts']],
      ['d.ts', []],
    ]);
    expect(findCycles(g)).toEqual([]);
  });
});

describe('no static import cycles in the shipped tree', () => {
  it('holds across src/ and app/', () => {
    const files = [...walk('src'), ...walk('app')];
    const graph = buildGraph(files);
    const edges = [...graph.values()].reduce((a, b) => a + b.length, 0);

    // Guard the guard: a graph that failed to resolve anything has no cycles either.
    expect(files.length, 'the walk found no modules').toBeGreaterThan(300);
    expect(edges, 'no import edges resolved — the specifier resolver is broken').toBeGreaterThan(1000);

    expect(
      findCycles(graph).map((c) => c.join(' → ')),
      'extract the shared value into a leaf module, or defer the dev-only edge with a dynamic import()',
    ).toEqual([]);
  });
});
