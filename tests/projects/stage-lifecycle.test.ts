import { computeAllStages, type StageRow } from '@/projects/stage-lifecycle';

function makeStages(statuses: Record<string, string>): StageRow[] {
  return (['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const).map((kind) => ({
    kind,
    status: (statuses[kind] ?? 'pending') as StageRow['status'],
  }));
}

function visuals(stages: ReturnType<typeof computeAllStages>) {
  return Object.fromEntries(stages.map((s) => [s.kind, s.visual]));
}

function reachables(stages: ReturnType<typeof computeAllStages>) {
  return stages.filter((s) => s.reachable).map((s) => s.kind);
}

describe('computeAllStages', () => {
  it('fresh project: explore=active, rest pending, viewing explore', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'active' }),
      'exploration',
    );
    expect(visuals(result)).toEqual({
      exploration: 'ongoing',
      spec: 'not_started',
      plan: 'not_started',
      execute: 'not_started',
      review: 'not_started',
      journal: 'not_started',
    });
    expect(reachables(result)).toEqual(['exploration']);
  });

  it('subset run: skipped stages are never reachable (non-navigable)', () => {
    // Spec+Plan from an uploaded exploration: exploration done, execute/review skipped.
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'active', plan: 'pending', execute: 'skipped', review: 'skipped' }),
      'spec',
    );
    const byKind = Object.fromEntries(result.map((s) => [s.kind, s]));
    expect(byKind.execute.visual).toBe('skipped');
    expect(byKind.review.visual).toBe('skipped');
    // The done upstream stage stays navigable (view the uploaded artifact); skipped ones do not.
    expect(reachables(result)).toContain('exploration');
    expect(reachables(result)).not.toContain('execute');
    expect(reachables(result)).not.toContain('review');
  });

  it('mid-flow: explore+spec done, plan active, viewing plan', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'done', plan: 'active' }),
      'plan',
    );
    expect(visuals(result)).toEqual({
      exploration: 'done',
      spec: 'done',
      plan: 'ongoing',
      execute: 'not_started',
      review: 'not_started',
      journal: 'not_started',
    });
    expect(reachables(result)).toEqual(['exploration', 'spec', 'plan']);
  });

  it('at review: execute=active in DB but before viewing → shows done', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'done', plan: 'done', execute: 'active' }),
      'review',
    );
    expect(visuals(result)).toEqual({
      exploration: 'done',
      spec: 'done',
      plan: 'done',
      execute: 'done',
      review: 'ongoing',
      journal: 'not_started',
    });
    expect(result.find((s) => s.kind === 'review')!.isCurrent).toBe(true);
  });

  it('at journal: all prior done/active → all show done, journal ongoing', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'done', plan: 'done', execute: 'done', review: 'active' }),
      'journal',
    );
    expect(visuals(result)).toEqual({
      exploration: 'done',
      spec: 'done',
      plan: 'done',
      execute: 'done',
      review: 'done',
      journal: 'ongoing',
    });
  });

  it('navigate BACK to spec from journal: all reached stages stay reachable', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'done', plan: 'done', execute: 'done', review: 'done', journal: 'active' }),
      'spec',
    );
    expect(visuals(result)).toEqual({
      exploration: 'done',
      spec: 'done',
      plan: 'done',
      execute: 'done',
      review: 'done',
      journal: 'ongoing',
    });
    // ALL stages reachable — user can navigate to any of them
    expect(reachables(result)).toEqual(['exploration', 'spec', 'plan', 'execute', 'review', 'journal']);
    expect(result.find((s) => s.kind === 'spec')!.isCurrent).toBe(true);
  });

  it('navigate to review without StageAdvance: execute=active, review=pending', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'done', plan: 'done', execute: 'active', review: 'pending' }),
      'review',
    );
    // Execute before viewing + was reached → done
    expect(result.find((s) => s.kind === 'execute')!.visual).toBe('done');
    // Review is viewing stage → ongoing
    expect(result.find((s) => s.kind === 'review')!.visual).toBe('ongoing');
    // Journal after viewing + pending → not_started
    expect(result.find((s) => s.kind === 'journal')!.visual).toBe('not_started');
  });

  it('navigate to journal without StageAdvance: stages between reached and viewing show done', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'done', plan: 'done', execute: 'active', review: 'pending' }),
      'journal',
    );
    // Execute before viewing → done
    expect(result.find((s) => s.kind === 'execute')!.visual).toBe('done');
    // Review between reached (execute) and viewing (journal) → done (no gap)
    expect(result.find((s) => s.kind === 'review')!.visual).toBe('done');
    // Journal is viewing → ongoing
    expect(result.find((s) => s.kind === 'journal')!.visual).toBe('ongoing');
  });

  it('locked stages show lock icon instead of check', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'done', plan: 'active' }),
      'plan',
      ['exploration', 'spec'],
    );
    expect(result.find((s) => s.kind === 'exploration')!.visual).toBe('locked');
    expect(result.find((s) => s.kind === 'spec')!.visual).toBe('locked');
    expect(result.find((s) => s.kind === 'plan')!.visual).toBe('ongoing');
  });

  it('locked + before viewing: shows locked not done', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'active' }),
      'spec',
      ['exploration'],
    );
    expect(result.find((s) => s.kind === 'exploration')!.visual).toBe('locked');
  });

  it('no viewing stage (null): purely DB-driven', () => {
    const result = computeAllStages(
      makeStages({ exploration: 'done', spec: 'active' }),
      null,
    );
    expect(visuals(result)).toEqual({
      exploration: 'done',
      spec: 'ongoing',
      plan: 'not_started',
      execute: 'not_started',
      review: 'not_started',
      journal: 'not_started',
    });
  });

  it('treats skipped stages as reachable passed stages', () => {
    const result = computeAllStages(
      [
        { kind: 'exploration', status: 'done' },
        { kind: 'spec', status: 'active' },
        { kind: 'plan', status: 'pending' },
        { kind: 'execute', status: 'skipped' },
        { kind: 'review', status: 'skipped' },
        { kind: 'journal', status: 'pending' },
      ] as StageRow[],
      'spec',
    );
    expect(result.find((s) => s.kind === 'execute')!.visual).toBe('skipped');
    expect(result.find((s) => s.kind === 'review')!.visual).toBe('skipped');
  });
});
