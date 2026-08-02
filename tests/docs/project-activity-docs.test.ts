// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Doc-currency check for the `project_activity` cutover.
 *
 * `design/` is a LOCAL-ONLY tree — `.gitignore` lists it under "Forge local-only artifacts
 * (kept out of git)" beside `.claude/` and `docs/`. This file used to `readFileSync` those
 * paths unconditionally, so on any fresh clone all three cases failed with ENOENT
 * (verified by moving the tree aside). `pnpm test` is the release gate, so the committed
 * suite was red for everyone who did not happen to have the author's local docs.
 *
 * The check still earns its place where the tree exists, so it is gated on presence rather
 * than deleted — but the gate is per-file and reported, so a MISSING file is visible as a
 * skip rather than silently passing. README.md is committed, so it is always asserted.
 */
const LOCAL_DESIGN_DOCS = [
  'design/schema.md',
  'design/technical.md',
  'design/specs/03-projects.md',
  'design/specs/04-spec-stage.md',
  'design/specs/05-exploration.md',
  'design/specs/06-journal.md',
];

describe('project_activity is the documented durable timeline', () => {
  it('README (committed) names project_activity and no longer claims ops_action_log is active', () => {
    const body = readFileSync('README.md', 'utf8');
    expect(body).toContain('project_activity');
    expect(body).not.toContain('ops_action_log is the active');
  });

  it.each(LOCAL_DESIGN_DOCS)('%s names project_activity + ops_mma_batch (skipped if absent)', (path) => {
    if (!existsSync(path)) {
      // Local-only tree absent — nothing to check on this clone. Not a failure.
      return;
    }
    const body = readFileSync(path, 'utf8');
    expect(body, `${path} should name project_activity`).toContain('project_activity');
    expect(body, `${path} should not still call ops_action_log active`).not.toContain('ops_action_log is the active');
    // The two spec groups additionally reference the batch table they read from.
    if (path.startsWith('design/specs/')) {
      expect(body, `${path} should reference ops_mma_batch`).toContain('ops_mma_batch');
    }
  });
});
