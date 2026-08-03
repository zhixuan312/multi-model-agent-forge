// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE_ID_PATTERN, NODE_ID_RE, isNodeId } from '@/journal/node-id';

/**
 * `node-id.ts` exists because the four-digit rule had been written out in several places,
 * two of them a defence-in-depth pair that is only defence-in-depth while both halves
 * agree. It centralised the standalone test — but five regexes still EMBEDDED the pattern
 * (a node filename, a log line, a directory filter, two citation paths), so the rule it
 * owns was still copied five times.
 */
const ROOT = process.cwd();

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return sources(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

describe('the node-id rule has one definition', () => {
  it('still means exactly four digits', () => {
    expect(isNodeId('0001')).toBe(true);
    expect(isNodeId('12345')).toBe(false);
    expect(isNodeId('12')).toBe(false);
    expect(isNodeId('abcd')).toBe(false);
    expect(NODE_ID_RE.source).toContain(NODE_ID_PATTERN);
  });

  it('is not written out anywhere else', () => {
    const offenders = [...sources('src'), ...sources('app')]
      .filter((f) => f !== 'src/journal/node-id.ts')
      .filter((f) => /\\d\{4\}/.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(offenders, 'embed NODE_ID_PATTERN instead of restating \\d{4}').toEqual([]);
  });
});
