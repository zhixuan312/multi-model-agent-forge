import { getTableColumns, getTableName } from 'drizzle-orm';
import { attachment, explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import * as schema from '@/db/schema';

function columnNames(table: Parameters<typeof getTableColumns>[0]) {
  const cols = getTableColumns(table);
  return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.name]));
}

describe('db/schema — Spec-5 exploration tables (no live DB)', () => {
  it('ops_mma_batch has the canonical columns; cwd NOT NULL for every route', () => {
    expect(getTableName(mmaBatch)).toBe('ops_mma_batch');
    expect(columnNames(mmaBatch)).toEqual({
      id: 'id',
      projectId: 'project_id',
      route: 'route',
      targetRepoId: 'target_repo_id',
      cwd: 'cwd',
      batchId: 'batch_id',
      status: 'status',
      request: 'request',
      result: 'result',
      dispatchedBy: 'dispatched_by',
      createdAt: 'created_at',
      terminalAt: 'terminal_at',
      costUsd: 'cost_usd',
      savedVsMainUsd: 'saved_vs_main_usd',
      inputTokens: 'input_tokens',
      outputTokens: 'output_tokens',
      durationMs: 'duration_ms',
      implementerModel: 'implementer_model',
      reviewerModel: 'reviewer_model',
      implementerTier: 'implementer_tier',
      loopRunId: 'loop_run_id',
    });
    const cols = getTableColumns(mmaBatch);
    expect(cols.cwd.notNull).toBe(true); // every route carries a cwd
    expect(cols.projectId.notNull).toBe(false); // nullable: loop dispatches are team-level (not project-scoped)
    expect(cols.targetRepoId.notNull).toBe(false); // null for research/journal-recall
    expect(cols.request.notNull).toBe(true);
    expect(cols.result.notNull).toBe(false); // only after terminal
    expect(cols.dispatchedBy.notNull).toBe(false); // actor-less resumed dispatch
    expect(cols.route.enumValues).toEqual([
      'investigate',
      'research',
      'journal_recall',
      'audit',
      'execute_plan',
      'review',
      'journal_record',
      'delegate',
      'orchestrate',
    ]);
    expect(cols.status.enumValues).toEqual(['dispatched', 'running', 'done', 'failed']);
    expect(cols.status.default).toBe('dispatched');
  });

  it('project_exploration_task has draft|running|recorded status (NO failed value)', () => {
    expect(getTableName(explorationTask)).toBe('project_exploration_task');
    const cols = getTableColumns(explorationTask);
    expect(cols.status.enumValues).toEqual(['draft', 'running', 'recorded']);
    expect(cols.status.enumValues).not.toContain('failed');
    expect(cols.status.default).toBe('draft');
    expect(cols.kind.enumValues).toEqual(['investigate', 'research', 'journal']);
    expect(cols.targetRepoId.notNull).toBe(false); // Zod enforces the conditional invariant
    expect(cols.prompt.notNull).toBe(true);
  });

  it('attachment has link|image|file kinds + a jsonb payload', () => {
    expect(getTableName(attachment)).toBe('project_attachment');
    const cols = getTableColumns(attachment);
    expect(cols.kind.enumValues).toEqual(['link', 'image', 'file']);
    expect(cols.label.notNull).toBe(true);
    expect(cols.payload.notNull).toBe(true);
  });

  it('the barrel re-exports the Spec-5 tables', () => {
    expect(schema.attachment).toBe(attachment);
    expect(schema.explorationTask).toBe(explorationTask);
    expect(schema.mmaBatch).toBe(mmaBatch);
  });
});
