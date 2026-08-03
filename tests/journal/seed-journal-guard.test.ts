// @vitest-environment node
/**
 * `pnpm db:seed-journal` writes the demo dataset over `<workspaceRoot>/.mma/journal/` — and
 * "over" means `rmSync(nodes/, { recursive: true })` first. That store is the one team-level
 * journal every recall reads and where `journal_record` appends each run's learnings; nothing
 * else backs it up.
 *
 * It sat in `package.json` beside `db:seed-templates`, which the README's bootstrap section
 * tells operators to run, and appeared in no documentation at all. The only way to learn it
 * was destructive was to read the file.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedJournal, JournalNotEmptyError } from '@/journal/seed-journal';
import { journalDirFor } from '@/journal/store-reader';

const roots: string[] = [];
const freshRoot = () => {
  const r = mkdtempSync(join(tmpdir(), 'forge-seedjournal-'));
  roots.push(r);
  return r;
};
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A journal that already holds one real node, as a team's would. */
function withExistingNode(root: string): string {
  const nodesDir = join(journalDirFor(root), 'nodes');
  mkdirSync(nodesDir, { recursive: true });
  writeFileSync(join(nodesDir, '0001-a-real-decision.md'), '---\nid: "0001"\n---\nreal work\n', 'utf8');
  return nodesDir;
}

describe('seedJournal refuses to delete a journal in use', () => {
  it('seeds a fresh workspace', () => {
    const root = freshRoot();
    const res = seedJournal(root);
    expect(res.nodes).toBeGreaterThan(0);
    expect(readdirSync(join(res.dir, 'nodes')).length).toBe(res.nodes);
  });

  it('throws rather than wiping a journal that already has nodes', () => {
    const root = freshRoot();
    const nodesDir = withExistingNode(root);

    expect(() => seedJournal(root)).toThrow(JournalNotEmptyError);
    // The team's node is still there — the refusal happens BEFORE the rmSync.
    expect(readdirSync(nodesDir)).toEqual(['0001-a-real-decision.md']);
  });

  it('names what it would have destroyed, and how to override', () => {
    const root = freshRoot();
    withExistingNode(root);
    try {
      seedJournal(root);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(JournalNotEmptyError);
      expect((e as Error).message).toMatch(/already holds 1 journal node/);
      expect((e as Error).message).toMatch(/--force/);
    }
  });

  it('still overwrites when the operator says so', () => {
    const root = freshRoot();
    const nodesDir = withExistingNode(root);
    const res = seedJournal(root, { force: true });
    expect(readdirSync(nodesDir)).not.toContain('0001-a-real-decision.md');
    expect(res.nodes).toBeGreaterThan(0);
  });
});
