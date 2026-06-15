import { getTableColumns, getTableName } from 'drizzle-orm';
import { loop, loopRun } from '@/db/schema/loop';
import { mmaBatch } from '@/db/schema/mma';

function columnNames(table: Parameters<typeof getTableColumns>[0]) {
  const cols = getTableColumns(table);
  return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.name]));
}

describe('db/schema/loop — loop table', () => {
  it('has the canonical columns + db names', () => {
    expect(getTableName(loop)).toBe('loop');
    expect(columnNames(loop)).toEqual({
      id: 'id',
      name: 'name',
      kind: 'kind',
      config: 'config',
      workerTier: 'worker_tier',
      cron: 'cron',
      targetBranch: 'target_branch',
      repoIds: 'repo_ids',
      enabled: 'enabled',
      createdBy: 'created_by',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
  });

  it('kind + worker_tier are constrained; enabled defaults true', () => {
    const c = getTableColumns(loop);
    expect(c.kind.enumValues).toEqual(['maintenance']);
    expect(c.workerTier.enumValues).toEqual(['standard', 'complex']);
    expect(c.enabled.notNull).toBe(true);
    expect(c.enabled.default).toBe(true);
    expect(c.name.notNull).toBe(true);
    expect(c.config.notNull).toBe(true);
    expect(c.cron.notNull).toBe(false); // nullable: NULL cron = one-time (adhoc)
    expect(c.targetBranch.notNull).toBe(false);
  });
});

describe('db/schema/loop — loop_run table', () => {
  it('has the canonical columns + db names', () => {
    expect(getTableName(loopRun)).toBe('loop_run');
    expect(columnNames(loopRun)).toEqual({
      id: 'id',
      loopId: 'loop_id',
      runId: 'run_id',
      repoId: 'repo_id',
      trigger: 'trigger',
      status: 'status',
      branch: 'branch',
      prUrl: 'pr_url',
      mmaBatchId: 'mma_batch_id',
      keyChanges: 'key_changes',
      verification: 'verification',
      filesChanged: 'files_changed',
      journalEntries: 'journal_entries',
      startedAt: 'started_at',
      finishedAt: 'finished_at',
    });
  });

  it('trigger + status are constrained; pr_url/branch nullable', () => {
    const c = getTableColumns(loopRun);
    expect(c.trigger.enumValues).toEqual(['schedule', 'manual']);
    expect(c.status.enumValues).toEqual(['running', 'changed', 'no_changes', 'failed']);
    expect(c.prUrl.notNull).toBe(false);
    expect(c.branch.notNull).toBe(false);
    expect(c.loopId.notNull).toBe(true);
    expect(c.repoId.notNull).toBe(true);
  });
});

describe('db/schema/mma — project_id is now nullable (loops are team-level)', () => {
  it('mma_batch.project_id is nullable', () => {
    expect(getTableColumns(mmaBatch).projectId.notNull).toBe(false);
  });
});
