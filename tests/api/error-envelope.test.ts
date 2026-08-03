// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The API has two error envelopes, and the difference is invisible at the call site:
 *   - most routes: `{ error: 'Repo not found.' }`               → `error` IS the sentence
 *   - configure-provider, connections/validate, loops: `{ error: 'not_found', message: … }`
 *                                                                → `error` is a machine CODE
 * `responseError` reads `message` first so it is correct for both. What it cannot rescue
 * is a machine code shipped with NO message: the user is then shown "not_found".
 *
 * Eleven such responses existed across the loops and export routes. This keeps the rule:
 * a lower_snake_case `error` must be accompanied by a `message`.
 */
const ROOT = process.cwd();

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...routeFiles(rel));
    else if (e.name === 'route.ts') out.push(rel);
  }
  return out;
}

describe('API error envelopes', () => {
  const files = routeFiles('app/api');

  it('scanned the route tree — a broken walk must not pass vacuously', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never ships a machine code without a human message', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      // `{ error: 'lower_snake' }` with no `message` before the closing brace.
      for (const m of text.matchAll(/\{\s*error:\s*'([a-z][a-z_]*)'\s*\}/g)) {
        offenders.push(`${rel}: { error: '${m[1]}' } has no message`);
      }
    }
    expect(offenders, 'give the code a `message`, or put the sentence in `error`').toEqual([]);
  });
});
/**
 * The client half of the same rule. Three sweeps missed real instances because each was
 * anchored on one incidental spelling: `catch(() => null)` (missed `catch(() => ({}))`),
 * then `res.ok` (missed the ten sites whose variable is `r`). This checks the CONCEPT —
 * any `!<something>.ok` guard that throws or toasts a literal, without consulting the
 * body — so the next one cannot hide behind a variable name.
 */
describe('client error handling', () => {
  const clientFiles: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (rel.endsWith('.tsx') && !rel.includes('.test.')) clientFiles.push(rel);
    }
  };
  walk('src');
  walk('app/(app)');

  it('scanned the client tree', () => {
    expect(clientFiles.length).toBeGreaterThan(50);
  });

  it('never throws a hardcoded message for a failed response without reading the body', () => {
    const offenders: string[] = [];
    for (const rel of clientFiles) {
      const text = readFileSync(join(ROOT, rel), 'utf8');
      for (const m of text.matchAll(/if \(!(\w+)\.ok\)\s*throw new Error\(([^)]*)\)/g)) {
        if (!m[2]!.includes('responseError')) offenders.push(`${rel}: ${m[0]!.slice(0, 70)}`);
      }
    }
    expect(offenders, 'use responseError(res, fallback) so the server’s reason reaches the user').toEqual([]);
  });
});
