// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildDiscoverTerminalLabel, auditTerminalLabel, appendBatchTerminalEvent } from '@/details/project-event-labels';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb } from '../test-utils/mock-db';

// buildDiscoverTerminalLabel turns a discover batch's request into the settled
// activity-line label. The distinguishing rule: sibling tasks of the same kind
// (e.g. 4 investigations of one repo) must NOT collapse into identical labels —
// each carries a short focus (the propose-time `title`, or a derived fallback from
// the prompt). Research/recall gain a subject the same way.
describe('buildDiscoverTerminalLabel', () => {
  const repoDb = () => createMockDb({ 'select:workspace_repo': [{ name: 'self_service_demo' }] });

  it('investigate with a title → repo + focus', async () => {
    const label = await buildDiscoverTerminalLabel(repoDb(), {
      taskKind: 'investigate', targetRepoId: 'r1', title: 'DB connection & config',
    });
    expect(label).toBe('Investigated self_service_demo — DB connection & config');
  });

  it('investigate without a title derives a focus from the prompt (distinguishes siblings)', async () => {
    const label = await buildDiscoverTerminalLabel(repoDb(), {
      taskKind: 'investigate', targetRepoId: 'r1',
      prompt: 'How does the backend connect to the database? Identify the client and config.',
    });
    expect(label.startsWith('Investigated self_service_demo — ')).toBe(true);
    expect(label).not.toBe('Investigated self_service_demo');
  });

  it('investigate with neither title nor prompt → bare repo label', async () => {
    const label = await buildDiscoverTerminalLabel(repoDb(), { taskKind: 'investigate', targetRepoId: 'r1' });
    expect(label).toBe('Investigated self_service_demo');
  });

  it('investigate with no repo and no focus → generic fallback', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), { taskKind: 'investigate' });
    expect(label).toBe('Investigated a repository');
  });

  it('research with a title → Researched — focus', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), {
      taskKind: 'research', title: 'JSON-file data-layer patterns',
    });
    expect(label).toBe('Researched — JSON-file data-layer patterns');
  });

  it('research without a focus → bare verb', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), { taskKind: 'research' });
    expect(label).toBe('Researched');
  });

  it('journal with a title → Recalled — focus', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), {
      taskKind: 'journal', title: 'DB-free demo decisions',
    });
    expect(label).toBe('Recalled — DB-free demo decisions');
  });

  it('journal without a focus → Recalled learnings', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), { taskKind: 'journal' });
    expect(label).toBe('Recalled learnings');
  });

  it('a long prompt-derived focus is trimmed to a compact label', async () => {
    const label = await buildDiscoverTerminalLabel(createMockDb({}), {
      taskKind: 'research',
      prompt: 'Patterns for backing an application data layer with static JSON files instead of a relational database including write handling and caching strategies',
    });
    expect(label.length).toBeLessThanOrEqual('Researched — '.length + 61);
    expect(label.startsWith('Researched — ')).toBe(true);
  });
});

// QA F2 — the durable audit line must keep the pass detail the live SSE progression showed,
// so navigating away and back doesn't collapse "Audited spec — pass 2 · revised" to "Audited spec".
describe('auditTerminalLabel', () => {
  it('appends the latest recorded pass number + status', () => {
    expect(auditTerminalLabel('Audited spec', [{ passNo: 1, status: 'revised' }, { passNo: 2, status: 'clean' }]))
      .toBe('Audited spec — pass 2 · clean');
  });
  it('returns the bare label when there are no passes', () => {
    expect(auditTerminalLabel('Audited plan', [])).toBe('Audited plan');
  });
});

/** The labels written to project_activity via .set()/.values() (cycle-safe — no JSON.stringify). */
function activityLabels(db: ReturnType<typeof createMockDb>): string[] {
  return db._callsFor('project_activity')
    .filter((c) => c.method === 'set' || c.method === 'values')
    .map((c) => (c.args[0] as { label?: string })?.label)
    .filter((l): l is string => typeof l === 'string');
}

describe('appendBatchTerminalEvent — audit enrichment', () => {
  it('records a spec-audit terminal with its pass detail read from details (survives navigation)', async () => {
    const d = buildInitialDetails();
    d.stages.spec.phases.finalize.auditPasses = [
      { passNo: 1, status: 'revised' },
      { passNo: 2, status: 'clean' },
    ];
    // No running row to resolve → the fallback path records ONE terminal row with the label.
    const db = createMockDb({ 'select:project': [{ details: d }], 'select:project_activity': [] });
    await appendBatchTerminalEvent(db, 'p1', 'spec-audit', 'batch-1', 'done', 3000);
    expect(activityLabels(db)).toContain('Audited spec — pass 2 · clean');
  });

  it('leaves a non-audit handler label untouched', async () => {
    const db = createMockDb({ 'select:project': [{ details: buildInitialDetails() }], 'select:project_activity': [] });
    await appendBatchTerminalEvent(db, 'p1', 'plan-author', 'batch-2', 'done', 1000);
    const labels = activityLabels(db);
    expect(labels).toContain('Authored plan');
    expect(labels.some((l) => l.includes('pass'))).toBe(false);
  });
});
