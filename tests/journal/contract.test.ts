// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EDGE_TYPES, STATUS_VALUES, LOG_OPS } from '@/journal/types';
import { parseFrontmatter, parseIndexRow, parseLogLine } from '@/journal/store-reader';

const enumsFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/mma-enums.json', import.meta.url)), 'utf8'),
) as { EDGE_TYPES: string[]; STATUS_VALUES: string[]; LOG_OPS: string[] };

describe('enum drift guard (local copy === MMA source enum sets)', () => {
  it('EDGE_TYPES matches the MMA fixture', () => {
    expect([...EDGE_TYPES]).toEqual(enumsFixture.EDGE_TYPES);
  });
  it('STATUS_VALUES matches the MMA fixture', () => {
    expect([...STATUS_VALUES]).toEqual(enumsFixture.STATUS_VALUES);
  });
  it('LOG_OPS matches the MMA fixture', () => {
    expect([...LOG_OPS]).toEqual(enumsFixture.LOG_OPS);
  });
});

describe('on-disk format contract (pins column/delimiter/key shapes)', () => {
  it('index.md column order is | id | timestamp | type | status | title | tags | (OKF) with comma-separated tags', () => {
    const row = parseIndexRow(
      '| 0013 | 2026-05-24 | decision | adopted | Prefer parallel dispatch | concurrency, dispatch, git |',
    );
    expect(row).toEqual({
      id: '0013',
      timestamp: '2026-05-24',
      type: 'decision',
      status: 'adopted',
      title: 'Prefer parallel dispatch',
      tags: ['concurrency', 'dispatch', 'git'],
    });
  });

  it('log.md field order is <ISO-8601>  <op>  <id>  <title>', () => {
    const e = parseLogLine('2026-05-24T00:00:00+08:00  create  0013  Prefer parallel dispatch');
    expect(e).toEqual({
      timestamp: '2026-05-24T00:00:00+08:00',
      op: 'create',
      id: '0013',
      title: 'Prefer parallel dispatch',
    });
  });

  it('node frontmatter keys (block-sequence tags/links) parse as the contract', () => {
    const raw = [
      '---',
      'id: "0013"',
      'title: "Prefer same-repo parallel dispatch with scoped git commits"',
      'status: "adopted"',
      'tags:',
      '  - concurrency',
      '  - dispatch',
      'timestamp: "2026-05-24"',
      'links:',
      '  - type: "supersedes"',
      '    target: "0012"',
      'supersededBy: null',
      '---',
      '## Context',
      'c',
      '## Consequences',
      'q',
    ].join('\n');
    const r = parseFrontmatter(raw, '0013-foo.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.id).toBe('0013');
    expect(r.node.tags).toEqual(['concurrency', 'dispatch']);
    expect(r.node.links).toEqual([{ type: 'supersedes', target: '0012' }]);
  });
});
