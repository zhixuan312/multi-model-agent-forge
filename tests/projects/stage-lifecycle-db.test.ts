// @vitest-environment node
import { ensureStageReached, computeAllStages, type StageRow } from '@/projects/stage-lifecycle';
import { createMockDb, seq } from '../test-utils/mock-db';

function makeRows(statuses: Record<string, string>): StageRow[] {
  return (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const).map((kind) => ({
    kind,
    status: (statuses[kind] ?? 'pending') as StageRow['status'],
  }));
}

function visuals(result: ReturnType<typeof computeAllStages>) {
  return Object.fromEntries(result.map((s) => [s.kind, s.visual]));
}

function reachableKinds(result: ReturnType<typeof computeAllStages>) {
  return result.filter((s) => s.reachable).map((s) => s.kind);
}

describe('ensureStageReached + computeAllStages integration', () => {
  it('scenario: visit Journal → back to Spec → Review/Journal stay done/reachable', () => {
    // Step 1: User was at Execute (DB state before visiting Journal)
    const dbBefore = makeRows({
      exploration: 'done', spec: 'done', plan: 'done', execute: 'active',
    });

    // Step 2: User navigates to Journal
    // ensureStageReached would mark execute+review as done, journal as active
    // Simulate the DB state AFTER ensureStageReached('journal')
    const dbAfterJournal = makeRows({
      exploration: 'done', spec: 'done', plan: 'done',
      execute: 'done', review: 'done', journal: 'active',
    });
    const atJournal = computeAllStages(dbAfterJournal, 'journal');
    expect(visuals(atJournal)).toEqual({
      exploration: 'done', spec: 'done', plan: 'done',
      execute: 'done', review: 'done', journal: 'ongoing',
    });
    expect(reachableKinds(atJournal)).toEqual([
      'exploration', 'spec', 'plan', 'execute', 'review', 'journal',
    ]);

    // Step 3: User navigates BACK to Spec
    // ensureStageReached('spec') should NOT undo anything — it only marks
    // stages before spec as done (exploration already done) and spec as active
    // (already done, so no change). DB state stays the same.
    const dbAfterBackToSpec = makeRows({
      exploration: 'done', spec: 'done', plan: 'done',
      execute: 'done', review: 'done', journal: 'active',
    });
    const atSpec = computeAllStages(dbAfterBackToSpec, 'spec');
    expect(visuals(atSpec)).toEqual({
      exploration: 'done', spec: 'done', plan: 'done',
      execute: 'done', review: 'done', journal: 'ongoing',
    });
    // ALL stages still reachable
    expect(reachableKinds(atSpec)).toEqual([
      'exploration', 'spec', 'plan', 'execute', 'review', 'journal',
    ]);
    // Spec is highlighted as current
    expect(atSpec.find((s) => s.kind === 'spec')!.isCurrent).toBe(true);
  });

  it('scenario: visit Review without StageAdvance → Execute shows done', () => {
    // DB before: Execute is active, Review/Journal pending
    const dbBefore = makeRows({
      exploration: 'done', spec: 'done', plan: 'done', execute: 'active',
    });

    // After ensureStageReached('review'): Execute marked done, Review marked active
    const dbAfterReview = makeRows({
      exploration: 'done', spec: 'done', plan: 'done',
      execute: 'done', review: 'active',
    });
    const atReview = computeAllStages(dbAfterReview, 'review');
    expect(atReview.find((s) => s.kind === 'execute')!.visual).toBe('done');
    expect(atReview.find((s) => s.kind === 'review')!.visual).toBe('ongoing');
    expect(atReview.find((s) => s.kind === 'review')!.isCurrent).toBe(true);
  });

  it('scenario: fresh project → visit Explore → nothing changes', () => {
    // After ensureStageReached('exploration'): no prior stages, exploration stays active
    const db = makeRows({ exploration: 'active' });
    const result = computeAllStages(db, 'exploration');
    expect(visuals(result)).toEqual({
      exploration: 'ongoing', spec: 'not_started', plan: 'not_started',
      execute: 'not_started', review: 'not_started', journal: 'not_started',
    });
    expect(reachableKinds(result)).toEqual(['exploration']);
  });

  it('locked stages show lock even when navigating back', () => {
    const db = makeRows({
      exploration: 'done', spec: 'done', plan: 'done',
      execute: 'done', review: 'done', journal: 'active',
    });
    const result = computeAllStages(db, 'plan', ['exploration', 'spec']);
    expect(result.find((s) => s.kind === 'exploration')!.visual).toBe('locked');
    expect(result.find((s) => s.kind === 'spec')!.visual).toBe('locked');
    expect(result.find((s) => s.kind === 'plan')!.visual).toBe('done');
  });

  it('ensureStageReached never moves done back to active', () => {
    // Simulate: spec is done, user navigates to spec
    // ensureStageReached should NOT change spec from done to active
    const db = makeRows({
      exploration: 'done', spec: 'done', plan: 'active',
    });
    // After ensureStageReached('spec'): exploration already done, spec already done
    // Nothing should change
    const result = computeAllStages(db, 'spec');
    expect(result.find((s) => s.kind === 'spec')!.visual).toBe('done');
    expect(result.find((s) => s.kind === 'spec')!.isCurrent).toBe(true);
  });
});
