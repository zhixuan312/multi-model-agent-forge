import { repairActiveStage } from '@/automation/stage-repair';
import { buildInitialDetails } from '@/details/schema';

function withStatuses(s: Record<string, string>) {
  const d = buildInitialDetails();
  for (const [k, v] of Object.entries(s)) (d.stages as Record<string, { status: string }>)[k].status = v;
  return d;
}

describe('repairActiveStage (exactly one active stage invariant, spec §2 / AC16)', () => {
  it('exactly one active with an active phase → unchanged', () => {
    const d = withStatuses({ exploration: 'done', spec: 'active' });
    d.stages.spec.phases.outline.status = 'active';
    const { changed } = repairActiveStage(d);
    expect(changed).toBe(false);
    expect(d.stages.spec.status).toBe('active');
    expect(d.stages.spec.phases.outline.status).toBe('active');
  });
  it('one active stage but NO active phase → reopen its first pending phase', () => {
    // The initial-state bug: exploration active, brief left pending → set_brief rejected.
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.status = 'pending';
    const { changed } = repairActiveStage(d);
    expect(changed).toBe(true);
    expect(d.stages.exploration.phases.brief.status).toBe('active');
  });
  it('one active stage mid-way (first phase done) → reopen the next pending phase, not phase 1', () => {
    const d = buildInitialDetails();
    d.stages.exploration.phases.brief.status = 'done';
    d.stages.exploration.phases.discover.status = 'pending';
    const { changed } = repairActiveStage(d);
    expect(changed).toBe(true);
    expect(d.stages.exploration.phases.brief.status).toBe('done');
    expect(d.stages.exploration.phases.discover.status).toBe('active');
  });
  it('multiple active → keep earliest, later → pending', () => {
    const d = withStatuses({ exploration: 'done', spec: 'active', plan: 'active', review: 'active' });
    const { changed } = repairActiveStage(d);
    expect(changed).toBe(true);
    expect(d.stages.spec.status).toBe('active');
    expect(d.stages.plan.status).toBe('pending');
    expect(d.stages.review.status).toBe('pending');
  });
  it('zero active, some not done → activate earliest non-done', () => {
    const d = withStatuses({ exploration: 'done', spec: 'done', plan: 'pending' });
    const { changed } = repairActiveStage(d);
    expect(changed).toBe(true);
    expect(d.stages.plan.status).toBe('active');
  });
  it('zero active, all done → no activation (completion path handles it)', () => {
    const d = withStatuses({ exploration: 'done', spec: 'done', plan: 'done', execute: 'done', review: 'done', journal: 'done' });
    const { changed } = repairActiveStage(d);
    expect(changed).toBe(false);
    expect(Object.values(d.stages).every((s) => (s as { status: string }).status === 'done')).toBe(true);
  });
});
