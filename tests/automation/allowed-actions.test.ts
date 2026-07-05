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
