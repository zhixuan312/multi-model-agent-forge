import { getTableColumns, getTableName } from 'drizzle-orm';
import { loop, loopEventDelivery, loopRun } from '@/db/schema/loop';
import { mmaBatch } from '@/db/schema/ops';

function columnNames(table: Parameters<typeof getTableColumns>[0]) {
  const cols = getTableColumns(table);
  return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.name]));
}

describe('db/schema/loop — loop table', () => {
  it('has the canonical columns + db names', () => {
    expect(getTableName(loop)).toBe('loop_def');
    expect(columnNames(loop)).toEqual({
      id: 'id',
      teamId: 'team_id',
      name: 'name',
      kind: 'kind',
      config: 'config',
      workerTier: 'worker_tier',
      mode: 'mode',
      cron: 'cron',
      targetBranch: 'target_branch',
      repoIds: 'repo_ids',
      eventTokenHash: 'event_token_hash',
      enabled: 'enabled',
      createdBy: 'created_by',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    });
  });

  it('kind + worker_tier + mode are constrained; event token stays nullable', () => {
    const c = getTableColumns(loop);
    expect(c.kind.enumValues).toEqual(['maintenance']);
    expect(c.workerTier.enumValues).toEqual(['standard', 'complex']);
    expect(c.mode.enumValues).toEqual(['recurring', 'manual', 'event']);
    expect(c.eventTokenHash.notNull).toBe(false);
    expect(c.enabled.notNull).toBe(true);
    expect(c.enabled.default).toBe(true);
    expect(c.cron.notNull).toBe(false);
    expect(c.targetBranch.notNull).toBe(false);
  });
});

describe('db/schema/loop — loop_run table', () => {
  it('has the canonical columns + db names', () => {
    expect(getTableName(loopRun)).toBe('loop_run');
    expect(columnNames(loopRun)).toEqual({
      id: 'id',
      teamId: 'team_id',
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
      idempotencyKey: 'idempotency_key',
      reference: 'reference',
      startedAt: 'started_at',
      finishedAt: 'finished_at',
    });
  });

  it('trigger + status are constrained; idempotency/reference remain nullable trace fields', () => {
    const c = getTableColumns(loopRun);
    expect(c.trigger.enumValues).toEqual(['schedule', 'manual', 'event']);
    expect(c.status.enumValues).toEqual(['running', 'changed', 'no_changes', 'failed']);
    expect(c.idempotencyKey.notNull).toBe(false);
    expect(c.reference.notNull).toBe(false);
    expect(c.prUrl.notNull).toBe(false);
    expect(c.branch.notNull).toBe(false);
  });
});

describe('db/schema/loop — loop_event_delivery table', () => {
  it('has the canonical columns + db names', () => {
    expect(getTableName(loopEventDelivery)).toBe('loop_event_delivery');
    expect(columnNames(loopEventDelivery)).toEqual({
      id: 'id',
      teamId: 'team_id',
      loopId: 'loop_id',
      idempotencyKey: 'idempotency_key',
      runId: 'run_id',
      reference: 'reference',
      createdAt: 'created_at',
    });
  });

  it('stores one delivery row per accepted event with nullable reference only', () => {
    const c = getTableColumns(loopEventDelivery);
    expect(c.teamId.notNull).toBe(true);
    expect(c.loopId.notNull).toBe(true);
    expect(c.idempotencyKey.notNull).toBe(true);
    expect(c.runId.notNull).toBe(true);
    expect(c.reference.notNull).toBe(false);
  });
});

describe('db/schema/mma — project_id is now nullable (loops are team-level)', () => {
  it('ops_mma_batch.project_id is nullable', () => {
    expect(getTableColumns(mmaBatch).projectId.notNull).toBe(false);
  });
});
