// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface JournalNode {
  id: string;
  title: string;
  context: string;
  consequences: string;
  description: string;
}

interface JournalLogEntry {
  id: string;
  op: string;
  timestamp: string;
  title: string;
}

describe('journal seed node 0037', () => {
  it('re-records node 0037 to reflect that Forge now has role-based access control', () => {
    const nodes = JSON.parse(readFileSync(join(process.cwd(), 'src/journal/seed-data/journal-nodes.json'), 'utf8')) as JournalNode[];
    const node = nodes.find((entry) => entry.id === '0037');

    expect(node).toBeDefined();
    expect(node?.title).toContain('RBAC');
    expect(node?.context).toContain('team_admin');
    expect(node?.context).toContain('org_admin');
    expect(node?.consequences).toContain('member');
    expect(node?.description).toContain('Forge now ships real team/role RBAC');
  });

  it('adds a fresh refine log entry for the 2026-07-24 re-recording', () => {
    const log = JSON.parse(readFileSync(join(process.cwd(), 'src/journal/seed-data/journal-log.json'), 'utf8')) as JournalLogEntry[];
    const newest0037 = log.filter((entry) => entry.id === '0037').at(-1);

    expect(newest0037).toEqual({
      timestamp: '2026-07-24T00:00:00Z',
      op: 'refine',
      id: '0037',
      title: 'Re-record Forge RBAC reality now that team and org roles exist in production code',
    });
  });
});
