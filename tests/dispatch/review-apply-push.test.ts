// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Records every git invocation so we can assert exactly which pushes were attempted.
const gitCalls: string[][] = [];
let currentBranch = '';
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((_cmd: string, argv: string[]) => {
    gitCalls.push(argv);
    return argv.includes('--show-current') ? `${currentBranch}\n` : '';
  }),
}));
vi.mock('@/details/write', () => ({ updateDetails: vi.fn(async () => {}) }));

import '@/dispatch/handlers/review-apply';
import { getHandler } from '@/dispatch/handler-registry';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

const CWD = '/repos/demo';

/** A project whose own branch is `mma/2026-07-31-proj` (SGT-dated creation). */
function dbWithRepo() {
  const details = buildInitialDetails();
  details.repos = [{ id: 'r1', name: 'demo', pathOnDisk: CWD, defaultBranch: 'main' }];
  return createMockDb({
    'select:project': [{ details, name: 'Proj', createdAt: new Date('2026-07-31T00:00:00Z') }],
  });
}

const ctx = { batchRowId: 'b1', projectId: 'p1', handler: 'review-apply', request: { repoId: 'r1' }, actorId: null };

describe('review-apply push guard — exact project branch, not just the mma/ prefix', () => {
  beforeEach(() => { gitCalls.length = 0; });

  it('force-pushes when the clone is on THIS project\'s branch', async () => {
    currentBranch = 'mma/2026-07-31-proj';
    await getHandler('review-apply')!(dbWithRepo(), ctx, {});
    const push = gitCalls.find((a) => a.includes('push'));
    expect(push).toBeDefined();
    expect(push).toContain('mma/2026-07-31-proj');
  });

  it('does NOT push a DIFFERENT project\'s branch that shares the clone', async () => {
    // Several projects can target one clone, so a `startsWith('mma/')` test would
    // force-push a sibling project's branch and overwrite its remote with our commits.
    currentBranch = 'mma/2026-07-30-other-project';
    await getHandler('review-apply')!(dbWithRepo(), ctx, {});
    expect(gitCalls.find((a) => a.includes('push'))).toBeUndefined();
  });

  it('does NOT push a loop-run branch, which now also lives under mma/', async () => {
    // Loop branches were `loop/…` before the rename, so the old prefix test excluded
    // them structurally; under one `mma/` namespace only an exact match does.
    currentBranch = 'mma/2026-07-31-093000000-nightly';
    await getHandler('review-apply')!(dbWithRepo(), ctx, {});
    expect(gitCalls.find((a) => a.includes('push'))).toBeUndefined();
  });
});
