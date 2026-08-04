// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Every `vi.mock()` target inside `tests/` must name a module that still exists.
 *
 * `vi.mock(path, factory)` registers a mock LAZILY: if nothing in the graph imports that
 * path, the factory never runs and the specifier is never resolved. So a mock left behind
 * for a deleted module is silently inert — no error, no warning, and a green suite.
 *
 * That is how `@/observability/poll-log` survived in `exploration/dispatch-tasks.test.ts`
 * after the module was folded into `observability/log-event.ts`. The line read as active
 * protection ("this test isolates itself from the poll logger") while protecting nothing,
 * and it pointed a reader at a file that had not existed for some time.
 *
 * The failure mode this really guards is the opposite one: a mock that is meant to prevent
 * a test from touching the network, the filesystem or the database, aimed at a path that
 * has since MOVED. The suite stays green and the real module runs. A stale mock is not a
 * harmless leftover — it is a disabled safety belt that still looks fastened.
 *
 * Only `@/…` and relative specifiers are checked. Bare package names (`node:fs`,
 * `puppeteer`) resolve through node_modules and are out of scope here.
 */
const MOCK_CALL = /vi\.mock\(\s*['"]([^'"]+)['"]/g;
const CANDIDATE_EXTS = ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'];

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) testFiles(p, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

function resolves(specifier: string, fromFile: string): boolean {
  const base = specifier.startsWith('@/')
    ? resolve('src', specifier.slice(2))
    : resolve(fromFile, '..', specifier);
  if (CANDIDATE_EXTS.some((ext) => existsSync(base + ext))) return true;
  return existsSync(base) && statSync(base).isFile();
}

describe('no test mocks a module that no longer exists', () => {
  it('every @/ and relative vi.mock target resolves to a real file', () => {
    const files = testFiles('tests');
    const phantoms: string[] = [];
    let checked = 0;

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(MOCK_CALL)) {
        const specifier = match[1];
        // Bare package specifiers are resolved by node, not by this walk.
        if (!specifier.startsWith('@/') && !specifier.startsWith('.')) continue;
        checked++;
        if (!resolves(specifier, file)) phantoms.push(`${file} mocks missing module '${specifier}'`);
      }
    }

    // Guard the guard: if the walk stops finding mock calls (a moved `tests/` root, a
    // changed helper name), this check would pass by examining nothing at all.
    expect(checked, 'the sweep found no vi.mock targets — it is no longer checking anything').toBeGreaterThan(150);
    expect(phantoms).toEqual([]);
  });
});
