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
