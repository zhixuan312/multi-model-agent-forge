import { describe, expect, it } from 'vitest';
import { allowedActions } from '@/automation/allowed-actions';
import { buildInitialDetails, type Details } from '@/details/schema';

/**
 * Journal learnings live in the `project_journal` TABLE — rows with ids, which is what
 * `approve_learning` / `edit_learning` / `remove_learning` address. The resolver used to
 * read `details.stages.journal.phases.journal.learnings` instead, an array that NOTHING
 * writes any more (the harvest handler inserts rows; only the legacy backfill still reads
 * the array). It was therefore always empty, and the whole Journal stage was dead:
 *
 *   - auto went straight from harvest to `mark_complete`, so learnings were never
 *     approved and never recorded to MMA — the stage's entire purpose, skipped silently;
 *   - manual fared no better, because the gate only permits what the resolver offers, so
 *     every button in the Journal UI came back "action … not allowed now".
 *
 * The row states are now an explicit input, so the resolver cannot silently conclude
 * "nothing to do" from data it was never given.
 */
function afterHarvest(): Details {
  const d = buildInitialDetails();
  d.stages.exploration.phases.synthesize.file = 'exploration.md';
  d.stages.spec.phases.finalize.approvals = ['m1'];
  d.stages.plan.phases.refine.tasks = [
    { id: 't1', title: 'T', status: 'committed', approvals: ['m1'], attempts: [], reviewPolicy: 'reviewed' },
  ];
  d.stages.plan.phases.validate.auditPasses = [{ passNo: 1, status: 'clean' }];
  d.stages.execute.phases.implement.repos = [{ repoId: 'r1', attempts: [{ batchId: 'e1', status: 'done', at: '' }] }];
  d.stages.review.phases.review.repos = [
    { repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'clean', review: { attempts: [{ batchId: 'v', status: 'done', at: '' }] } }] },
  ];
  for (const k of ['exploration', 'spec', 'plan', 'execute', 'review'] as const) d.stages[k].status = 'done';
  d.stages.journal.status = 'active';
  d.stages.journal.phases.journal.status = 'active';
  d.stages.journal.phases.journal.attempts = [{ batchId: 'h1', status: 'done', at: '' }];
  return d;
}

describe('the Journal stage is driven by project_journal rows', () => {
  it('approves the first proposed row, naming the row the effect needs', () => {
    const [action] = allowedActions(afterHarvest(), 'auto', {
      journalRows: [{ id: 'r1', status: 'proposed' }, { id: 'r2', status: 'proposed' }],
    });
    expect(action.kind).toBe('approve_learning');
    expect(action.data?.rowId).toBe('r1');
  });

  it('records once every row is settled and one is kept', () => {
    const [action] = allowedActions(afterHarvest(), 'auto', {
      journalRows: [{ id: 'r1', status: 'kept' }, { id: 'r2', status: 'removed' }],
    });
    expect(action.kind).toBe('dispatch_record');
  });

  it('completes only once no row is left to approve or record', () => {
    const [action] = allowedActions(afterHarvest(), 'auto', {
      journalRows: [{ id: 'r1', status: 'recorded' }, { id: 'r2', status: 'removed' }],
    });
    expect(action.kind).toBe('mark_complete');
  });

  it('never completes while a harvested row still sits unapproved', () => {
    const kinds = allowedActions(afterHarvest(), 'auto', {
      journalRows: [{ id: 'r1', status: 'proposed' }],
    }).map((a) => a.kind);
    expect(kinds).not.toContain('mark_complete');
  });

  it('lets a human edit or remove a row the gate would otherwise refuse', () => {
    const kinds = allowedActions(afterHarvest(), 'manual', {
      journalRows: [{ id: 'r1', status: 'proposed' }],
    }).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['approve_learning', 'edit_learning', 'remove_learning']));
  });

  it('offers no row action when the harvest produced nothing', () => {
    const kinds = allowedActions(afterHarvest(), 'manual', { journalRows: [] }).map((a) => a.kind);
    expect(kinds).not.toContain('approve_learning');
    expect(kinds).not.toContain('dispatch_record');
    expect(kinds).toContain('mark_complete');
  });
});

/**
 * The legacy `details…learnings` array is migration input for `backfillProjectJournalIfNeeded`
 * and nothing else. A decision read from it is a decision read from data no writer maintains.
 */
describe('the legacy details learnings array drives nothing', () => {
  it('is ignored by the resolver even when populated', () => {
    const d = afterHarvest();
    d.stages.journal.phases.journal.learnings = [
      { heading: 'L1', type: 'decision', status: 'proposed' },
    ];
    const [action] = allowedActions(d, 'auto', { journalRows: [] });
    expect(action.kind).not.toBe('approve_learning');
  });

  it('has exactly one reader in src — the backfill', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const p = `${dir}/${e}`;
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [];
      });
    const readers = walk('src').filter((f) => /phases\.journal\.learnings/.test(readFileSync(f, 'utf8')));
    expect(readers).toEqual(['src/journal/project-journal-backfill.ts']);
  });
});
