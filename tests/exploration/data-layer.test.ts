// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mmaBatch } from '@/db/schema/ops';

/**
 * `ops_mma_batch` must let a task be repo-less while still recording where it ran.
 *
 * This file previously stated that claim in its title and then proved nothing: it stuffed
 * three literal rows into `createMockDb`, read them back through the mock, and asserted the
 * values it had just written. `createMockDb` returns its fixture verbatim, so every
 * assertion reduced to `expect(fixture.x).toBe(fixture.x)` and NO production code ran —
 * not the schema, not the query, not the dispatch path. It could not fail for any state of
 * this codebase, including a schema where `cwd` had become nullable.
 *
 * The claim itself is real and worth holding, so it is asserted against the actual Drizzle
 * column metadata instead. The behavioural half — that `research`/`journal_recall` dispatch
 * with the workspace root as cwd while `investigate` uses its repo path — is covered by
 * `dispatch-tasks.test.ts`, which invokes the real `dispatchTasks`.
 */
describe('ops_mma_batch column contract', () => {
  it('allows a repo-less task but never a cwd-less one', () => {
    // `research` and `journal_recall` target no repo, so `target_repo_id` must be nullable…
    expect(mmaBatch.targetRepoId.notNull, 'a repo-less route could not be stored').toBe(false);
    // …but every route runs SOMEWHERE, and the run directory is what makes a batch
    // reproducible and auditable. A nullable cwd would let a batch exist with no record of
    // where it executed.
    expect(mmaBatch.cwd.notNull, 'cwd must be recorded for every batch').toBe(true);
  });

  it('keeps a batch attributable even when its dispatcher or project is gone', () => {
    // Scheduled loop runs have no human dispatcher, so this is nullable by design; the
    // FK is `on delete set null`, which is only expressible because of that.
    expect(mmaBatch.dispatchedBy.notNull).toBe(false);
    // `team_id` is the tenancy anchor and must survive both — every usage and cost query
    // scopes on it, so a null here would drop the row out of every team's accounting.
    expect(mmaBatch.teamId.notNull, 'team scope is what makes usage queries tenant-safe').toBe(true);
  });

  it('records the request that produced it, and tolerates having no result yet', () => {
    // Written at dispatch time, before anything comes back.
    expect(mmaBatch.request.notNull).toBe(true);
    // Null until the batch reaches a terminal state — a non-null result would force a
    // placeholder that readers could not distinguish from a real empty envelope.
    expect(mmaBatch.result.notNull).toBe(false);
    expect(mmaBatch.terminalAt.notNull).toBe(false);
  });
});
