import { repairActiveStage } from '@/automation/stage-repair';
import { buildInitialDetails } from '@/details/schema';

function withStatuses(s: Record<string, string>) {
  const d = buildInitialDetails();
  for (const [k, v] of Object.entries(s)) (d.stages as Record<string, { status: string }>)[k].status = v;
  return d;
}

describe('repairActiveStage (exactly one active stage invariant, spec §2 / AC16)', () => {
  it('exactly one active → unchanged', () => {
    const d = withStatuses({ exploration: 'done', spec: 'active' });
    const { changed } = repairActiveStage(d);
    expect(changed).toBe(false);
    expect(d.stages.spec.status).toBe('active');
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
