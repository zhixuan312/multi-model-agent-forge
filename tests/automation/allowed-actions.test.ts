import { allowedActions } from '@/automation/allowed-actions';
import { resolveNextActionFromDetails } from '@/automation/details-resolver';
import { buildInitialDetails } from '@/details/schema';

function stateFinalizeFresh() {
  const d = buildInitialDetails();
  d.stages.exploration.status = 'done';
  d.stages.spec.status = 'active';
  d.stages.spec.phases.finalize.status = 'active';
  return d;
}

function stateFinalizeOnePassRevised() {
  const d = stateFinalizeFresh();
  d.stages.spec.phases.finalize.auditPasses = [
    {
      passNo: 1,
      status: 'revised',
      audit: { attempts: [{ status: 'done', at: 'x' }] },
      fix: { attempts: [{ status: 'done', at: 'x' }] },
    },
  ] as unknown as typeof d.stages.spec.phases.finalize.auditPasses;
  return d;
}

describe('allowedActions — auto parity + determinism', () => {
  it('auto[0] equals the legacy resolver (finalize fresh → dispatch_audit)', () => {
    const d = stateFinalizeFresh();
    const auto = allowedActions(d, 'auto');
    expect(auto[0].kind).toBe(resolveNextActionFromDetails(d).kind);
    expect(auto[0].kind).toBe('dispatch_audit');
  });
  it('is deterministic (same input → same ordered kinds) [AC15]', () => {
    const d = stateFinalizeFresh();
    const a = allowedActions(d, 'auto').map((x) => x.kind);
    const b = allowedActions(d, 'auto').map((x) => x.kind);
    expect(a).toEqual(b);
  });
});

describe('allowedActions — exploration (Design phase, manual-only) [Task 8b-1]', () => {
  function exploring(phase: 'brief' | 'discover' | 'synthesize') {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'active';
    d.stages.exploration.phases.brief.status = phase === 'brief' ? 'active' : 'done';
    d.stages.exploration.phases.discover.status = phase === 'discover' ? 'active' : phase === 'synthesize' ? 'done' : 'pending';
    d.stages.exploration.phases.synthesize.status = phase === 'synthesize' ? 'active' : 'pending';
    return d;
  }
  const kinds = (d: ReturnType<typeof exploring>, m: 'auto' | 'manual') => allowedActions(d, m).map((a) => a.kind);

  it('auto never drives exploration (empty set)', () => {
    expect(allowedActions(exploring('brief'), 'auto')).toEqual([]);
  });
  it('brief + no tasks → [propose_discover_tasks]; +task → also advance_phase', () => {
    const d = exploring('brief');
    expect(kinds(d, 'manual')).toEqual(['propose_discover_tasks']);
    d.stages.exploration.phases.discover.tasks = [{ kind: 'investigate', prompt: 'x', status: 'draft', attempts: [] }] as never;
    expect(kinds(d, 'manual')).toContain('advance_phase');
  });
  it('discover with drafts → run_discover_tasks; all recorded → advance_phase', () => {
    const d = exploring('discover');
    d.stages.exploration.phases.discover.tasks = [{ kind: 'investigate', prompt: 'x', status: 'draft', attempts: [] }] as never;
    expect(kinds(d, 'manual')).toContain('run_discover_tasks');
    d.stages.exploration.phases.discover.tasks = [{ kind: 'investigate', prompt: 'x', status: 'recorded', attempts: [] }] as never;
    expect(kinds(d, 'manual')).toContain('advance_phase');
    expect(kinds(d, 'manual')).not.toContain('run_discover_tasks');
  });
  it('synthesize no-file → dispatch_synthesize; file set → advance_stage to spec', () => {
    const d = exploring('synthesize');
    expect(kinds(d, 'manual')).toContain('dispatch_synthesize');
    d.stages.exploration.phases.synthesize.file = '/x/exploration.md';
    expect(kinds(d, 'manual')).toContain('advance_stage');
  });
});

describe('allowedActions — manual audit-loop early exit', () => {
  it('manual set includes advance after ≥1 pass; auto does not', () => {
    const d = stateFinalizeOnePassRevised();
    const manual = allowedActions(d, 'manual').map((a) => a.kind);
    const auto = allowedActions(d, 'auto').map((a) => a.kind);
    expect(manual).toContain('approve_stage');
    expect(auto).not.toContain('approve_stage');
  });
  it('an in-flight audit → auto empty; manual has no early advance (button disabled)', () => {
    const d = stateFinalizeOnePassRevised();
    (d.stages.spec.phases.finalize.auditPasses[0] as { audit: { attempts: { status: string }[] } }).audit.attempts.push({ status: 'running' });
    expect(allowedActions(d, 'auto')).toEqual([]);
    expect(allowedActions(d, 'manual').every((a) => a.kind !== 'approve_stage')).toBe(true);
  });
});
