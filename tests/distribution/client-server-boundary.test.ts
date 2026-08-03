// @vitest-environment node
/**
 * No `'use client'` module may reach a Node builtin, however many hops away.
 *
 * This exists because the whole rest of the gate is blind to it. `ModelsPanel` — a client
 * component — imported `TIERS` from `@/mma/mma-config-reader`, which opens
 * `~/.mma/config.json` and so imports `node:fs`. That one word's difference (`import type`
 * erases, `import` does not) put Node's filesystem into the browser bundle and failed
 * `next build` outright:
 *
 *     the chunking context (unknown) does not support external modules (request: node:fs)
 *
 * tsc passed — the types were fine. eslint passed. All 2431 vitest tests passed, because they
 * run in Node where `node:fs` resolves happily. The dev server served the page, because
 * Turbopack chunks dev differently. Only a production build failed, and a production build is
 * slow enough that it was not being run.
 *
 * So the boundary is checked here, statically, in a second: follow every `@/…` import from
 * every client module and fail if the closure touches a builtin.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** `node:*` plus the bare names Node still accepts — a client bundle can carry none of them. */
const BUILTIN = /(?:^|from\s+['"])node:|from\s+['"](?:fs|os|path|crypto|child_process|net|tls|http|https|worker_threads|zlib|stream)['"]/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.next')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
  }
  return out;
}

/** Resolve an `@/x/y` specifier to the file that backs it. */
function resolveAlias(spec: string): string | null {
  const base = `src/${spec.slice(2)}`;
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(join(ROOT, cand))) return cand;
  }
  return null;
}

/**
 * VALUE imports only. `import type { … } from '@/mma/mma-config-reader'` is erased by the
 * compiler and never reaches a bundle — which is exactly why this bug was one keyword wide,
 * and why a check that ignored the distinction would flag half the codebase and be switched
 * off. Inline `type` specifiers inside a value import are fine; the module is still loaded.
 */
function valueImports(text: string): string[] {
  const out: string[] = [];
  // `[^'"]*?` for the clause, NOT `[\s\S]*?`: a dot-star that can cross quotes lets an
  // earlier plain `import … from 'react'` start the match and run on to a LATER `@/…`
  // specifier, so a type-only import is read as a value one. That produced a page of false
  // positives on the first run — and a check that cries wolf is a check that gets deleted.
  // A multi-line brace list contains no quotes, so this still spans them.
  for (const m of text.matchAll(/^[ \t]*import\s+(type\s+)?([^'"]*?)from\s*['"](@\/[^'"]+)['"]/gm)) {
    if (m[1]) continue; // `import type { … } from` — erased at compile time
    out.push(m[3]!);
  }
  return out;
}

/** Every module reachable by value from `entry`, with the path that got there. */
function closure(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue: Array<{ file: string; trail: string[] }> = [{ file: entry, trail: [entry] }];
  while (queue.length) {
    const { file, trail } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.set(file, trail);
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const spec of valueImports(text)) {
      const target = resolveAlias(spec);
      if (target && !seen.has(target)) queue.push({ file: target, trail: [...trail, target] });
    }
  }
  return seen;
}

describe('no client module reaches a Node builtin', () => {
  const all = [...sourceFiles('src'), ...sourceFiles('app')];
  const clientFiles = all.filter((f) => /^\s*['"]use client['"]/m.test(readFileSync(join(ROOT, f), 'utf8')));

  it('found the client modules — a broken scan must not pass vacuously', () => {
    expect(all.length).toBeGreaterThan(200);
    expect(clientFiles.length).toBeGreaterThan(30);
    expect(clientFiles).toContain('app/(app)/settings/models/ModelsPanel.tsx');
  });

  it('recognises a Node import when it sees one', () => {
    expect(BUILTIN.test(`import { readFileSync } from 'node:fs';`)).toBe(true);
    expect(BUILTIN.test(`import { join } from 'path';`)).toBe(true);
    expect(BUILTIN.test(`import { join } from '@/lib/cn';`)).toBe(false);
    // The reader really does carry one — if this ever stops being true the check is inert.
    expect(BUILTIN.test(readFileSync(join(ROOT, 'src/mma/mma-config-reader.ts'), 'utf8'))).toBe(true);
  });

  it('no client module pulls one in, at any depth', () => {
    const offenders: string[] = [];
    for (const entry of clientFiles) {
      for (const [file, trail] of closure(entry)) {
        if (file === entry) continue; // the client module's own Node import is a separate bug
        if (BUILTIN.test(readFileSync(join(ROOT, file), 'utf8'))) {
          offenders.push(`${trail.join(' → ')} (Node builtin)`);
        }
      }
    }
    expect(
      offenders,
      'a client bundle cannot contain Node builtins — move the value into a module without them, or import it as a type',
    ).toEqual([]);
  });
});
