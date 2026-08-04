// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No test may make its assertions ONLY from inside a `catch` that nothing forced to run.
 *
 *     it('rejects a clip >25 MB', () => {
 *       try {
 *         gateClip({ byteSize: MAX_CLIP_BYTES + 1, ... });   // if this stops throwing…
 *       } catch (e) {
 *         expect(e.status).toBe(413);                        // …this never runs
 *       }
 *     });                                                    // …and the case PASSES
 *
 * That shape executes zero assertions when the code under test stops throwing, which is
 * precisely the regression it was written to catch. Two such cases guarded the transcription
 * limits: replacing both the 25 MB and the 10-minute checks with `if (false)` left all 15
 * cases in that file green, with nothing between an arbitrarily large clip and a paid
 * OpenAI call.
 *
 * A case is considered guarded if, before the `catch`, it uses `toThrow`, `.rejects`,
 * `expect.assertions`/`hasAssertions`, or the explicit `throw new Error('should have
 * thrown')` idiom at the end of the `try`.
 *
 * ── Why this test validates its own checker ──
 * The scanner behind this rule was written twice wrong before it worked, in the two ways
 * these sweeps always fail:
 *   1. it counted the `}` of `} catch (e) {` as closing the catch block, so it only ever
 *      read that one line and found no `expect(` anywhere;
 *   2. its "already asserts a throw" filter matched the bare word `rejects`, which appears
 *      in the TITLE of nearly every test that checks a rejection — matching prose as code.
 * Both versions reported a clean sweep. A checker with a broken domain does not report an
 * error; it reports success. So the samples below are scanned by the same function that
 * scans the repo, and the rule fails if it stops flagging the shape it exists to flag.
 */
const CATCH_LINE = /\}\s*catch\s*(\(|\{)/;
const GUARDS = /toThrow|\.rejects\b|expect\.assertions|expect\.hasAssertions|should have thrown/;
const CASE_START = /\b(it|test)(\.\w+)?\s*\(/;

/** Lines of a source file that assert only from an unguarded catch. */
export function unguardedCatches(source: string): number[] {
  const lines = source.split('\n');
  const found: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!CATCH_LINE.test(lines[i])) continue;

    // Read the catch body. On the catch line itself, start at the brace that OPENS the
    // catch — the leading `}` closes the try, and counting it first ends the block early.
    let body = '';
    let depth = 0;
    let opened = false;
    for (let j = i; j < Math.min(lines.length, i + 40); j++) {
      const scan = j === i ? lines[j].slice(lines[j].indexOf('{', lines[j].indexOf('catch'))) : lines[j];
      for (const ch of scan) {
        if (ch === '{') { depth++; opened = true; } else if (ch === '}') { depth--; }
      }
      body += lines[j] + '\n';
      if (opened && depth <= 0) break;
    }
    if (!body.includes('expect(')) continue;

    // Everything between the enclosing `it(`/`test(` and the catch.
    let start = i;
    while (start > 0 && !CASE_START.test(lines[start])) start--;
    const before = lines.slice(start, i).join('\n');
    if (GUARDS.test(before) || GUARDS.test(body)) continue;

    found.push(i + 1);
  }
  return found;
}

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) testFiles(p, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe('the unguarded-catch scanner', () => {
  it('flags an assertion reachable only from an unforced catch', () => {
    const bad = [
      "it('rejects a clip >25 MB with 413', () => {",
      '  try {',
      '    gateClip({ byteSize: MAX + 1 });',
      '  } catch (e) {',
      '    expect(e.status).toBe(413);',
      '  }',
      '});',
    ].join('\n');
    // Line 4 is the `} catch (e) {`. Note the title contains "rejects" — the filter must
    // not read that as `.rejects`, which is how this scanner first missed real cases.
    expect(unguardedCatches(bad)).toEqual([4]);
  });

  it('accepts a catch whose try ends in the explicit should-have-thrown guard', () => {
    const ok = [
      "it('names what it would have destroyed', () => {",
      '  try {',
      '    seedJournal(root);',
      "    throw new Error('should have thrown');",
      '  } catch (e) {',
      '    expect(e).toBeInstanceOf(JournalNotEmptyError);',
      '  }',
      '});',
    ].join('\n');
    expect(unguardedCatches(ok)).toEqual([]);
  });

  it('accepts a catch preceded by an explicit toThrow', () => {
    const ok = [
      "it('rejects a bad MIME', () => {",
      '  expect(() => gateClip(bad)).toThrow(RejectError);',
      '  try {',
      '    gateClip(bad);',
      '  } catch (e) {',
      '    expect(e.status).toBe(415);',
      '  }',
      '});',
    ].join('\n');
    expect(unguardedCatches(ok)).toEqual([]);
  });
});

describe('no test asserts only from an unguarded catch', () => {
  it('holds across the whole suite', () => {
    const offenders: string[] = [];
    // This file is excluded from its own sweep: it deliberately contains the bad shape,
    // twice — once in the docstring and once as the sample the scanner is validated
    // against. Those samples are the reason the rule can be trusted, so they stay.
    const files = testFiles('tests').filter((f) => !f.endsWith('no-unguarded-catch-assertions.test.ts'));
    for (const file of files) {
      for (const line of unguardedCatches(readFileSync(file, 'utf8'))) {
        offenders.push(`${file}:${line}`);
      }
    }
    expect(files.length, 'the sweep found no test files — it is checking nothing').toBeGreaterThan(300);
    expect(offenders).toEqual([]);
  });
});
