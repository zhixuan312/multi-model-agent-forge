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
  it('brief → set_brief + propose_discover_tasks; +task → also advance_phase', () => {
    const d = exploring('brief');
    expect(kinds(d, 'manual')).toContain('set_brief');
    expect(kinds(d, 'manual')).toContain('propose_discover_tasks');
    expect(kinds(d, 'manual')).not.toContain('advance_phase'); // no tasks yet
    d.stages.exploration.phases.discover.tasks = [{ kind: 'investigate', prompt: 'x', status: 'draft', attempts: [] }] as never;
    expect(kinds(d, 'manual')).toContain('advance_phase');
    // Draft tasks can be dispatched from the brief/fan-out view before the phase
    // formally advances to Discover.
    expect(kinds(d, 'manual')).toContain('run_discover_tasks');
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

describe('allowedActions — spec Design phases (Task 8b-2)', () => {
  function specPhase(phase: 'outline' | 'craft') {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'active';
    d.stages.spec.phases.outline.status = phase === 'outline' ? 'active' : 'done';
    d.stages.spec.phases.craft.status = phase === 'craft' ? 'active' : 'pending';
    return d;
  }
  it('outline with ≥1 selected → advance_phase to craft', () => {
    const d = specPhase('outline');
    d.stages.spec.phases.outline.selectedTemplateIds = ['t1'];
    expect(allowedActions(d, 'manual').map((a) => a.kind)).toContain('advance_phase');
  });
  it('craft with an unapproved component → approve_component', () => {
    const d = specPhase('craft');
    d.stages.spec.phases.craft.components = [{ id: 'c1', templateId: 't1', approvals: [] }] as never;
    expect(allowedActions(d, 'manual').map((a) => a.kind)).toContain('approve_component');
  });
  it('craft with all approved → advance_phase to finalize', () => {
    const d = specPhase('craft');
    d.stages.spec.phases.craft.components = [{ id: 'c1', templateId: 't1', approvals: ['m1'] }] as never;
    const acts = allowedActions(d, 'manual');
    expect(acts.find((a) => a.kind === 'advance_phase')?.phase).toBe('finalize');
  });
});

describe('allowedActions — plan refine (manual direct approval)', () => {
  function planRefine(taskApprovals: string[]) {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'active';
    d.stages.plan.phases.refine.tasks = [{ id: 'task1', title: 'T1', approvals: taskApprovals, attempts: [] }] as never;
    return d;
  }
  it('unapproved task → manual may approve_task directly (no prior validate)', () => {
    expect(allowedActions(planRefine([]), 'manual').map((a) => a.kind)).toContain('approve_task');
  });
  it('all tasks approved → no approve_task offered', () => {
    expect(allowedActions(planRefine(['m1']), 'manual').map((a) => a.kind)).not.toContain('approve_task');
  });
});

describe('allowedActions — auto toggle (Task 8b-3)', () => {
  function atFinalize(status: 'off' | 'running') {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'active';
    d.stages.spec.phases.finalize.status = 'active';
    d.automation.status = status;
    return d;
  }
  it('manual while auto is running → ONLY take_over', () => {
    expect(allowedActions(atFinalize('running'), 'manual').map((a) => a.kind)).toEqual(['take_over']);
  });
  it('manual off at spec/finalize → includes start_auto', () => {
    expect(allowedActions(atFinalize('off'), 'manual').map((a) => a.kind)).toContain('start_auto');
  });
  it('manual off BEFORE spec/finalize (craft) → no start_auto (canAutoStart false)', () => {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'active';
    d.stages.spec.phases.craft.status = 'active';
    d.automation.status = 'off';
    expect(allowedActions(d, 'manual').map((a) => a.kind)).not.toContain('start_auto');
  });
  it('auto mode never offers start_auto/take_over', () => {
    const auto = allowedActions(atFinalize('running'), 'auto').map((a) => a.kind);
    expect(auto).not.toContain('take_over');
    expect(auto).not.toContain('start_auto');
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

describe('allowedActions — manual in-place refinement (refine forever)', () => {
  // A CLEAN pass (0 critical/high — only advisory medium/low findings). Auto advances;
  // manual must still be able to apply the advisory findings AND re-audit, staying on
  // the phase indefinitely. The state machine gates *advancing*, never *refining*.
  function stateFinalizeOneCleanPass() {
    const d = stateFinalizeFresh();
    d.stages.spec.phases.finalize.auditPasses = [
      { passNo: 1, status: 'clean', audit: { attempts: [{ status: 'done', at: 'x' }] } },
    ] as unknown as typeof d.stages.spec.phases.finalize.auditPasses;
    return d;
  }
  function statePlanValidateOneCleanPass() {
    const d = buildInitialDetails();
    d.stages.exploration.status = 'done';
    d.stages.spec.status = 'done';
    d.stages.plan.status = 'active';
    d.stages.plan.phases.refine.status = 'done';
    d.stages.plan.phases.validate.status = 'active';
    d.stages.plan.phases.validate.auditPasses = [
      { passNo: 1, status: 'clean', audit: { attempts: [{ status: 'done', at: 'x' }] } },
    ] as unknown as typeof d.stages.plan.phases.validate.auditPasses;
    return d;
  }
  function stateReviewOneCleanPass() {
    const d = buildInitialDetails();
    for (const s of ['exploration', 'spec', 'plan', 'execute'] as const) d.stages[s].status = 'done';
    d.stages.review.status = 'active';
    d.stages.review.phases.review.repos = [
      { repoId: 'r1', reviewPasses: [{ passNo: 1, status: 'clean', review: { attempts: [{ status: 'done', at: 'x' }] } }] },
    ] as never;
    return d;
  }

  it('spec finalize clean pass → manual can apply_findings AND re-run dispatch_audit; auto cannot', () => {
    const d = stateFinalizeOneCleanPass();
    const manual = allowedActions(d, 'manual').map((a) => a.kind);
    const auto = allowedActions(d, 'auto').map((a) => a.kind);
    expect(manual).toContain('apply_findings');
    expect(manual).toContain('dispatch_audit');
    expect(manual).toContain('approve_stage'); // advancing still permitted
    expect(auto).not.toContain('apply_findings'); // auto advances a clean pass, never applies
    expect(auto).toContain('approve_stage');
  });

  it('plan validate clean pass → manual can apply_findings AND re-audit', () => {
    const manual = allowedActions(statePlanValidateOneCleanPass(), 'manual').map((a) => a.kind);
    expect(manual).toContain('apply_findings');
    expect(manual).toContain('dispatch_audit');
  });

  it('review clean pass → manual can apply_review_findings AND re-run dispatch_review (per repo)', () => {
    const acts = allowedActions(stateReviewOneCleanPass(), 'manual');
    const kinds = acts.map((a) => a.kind);
    expect(kinds).toContain('apply_review_findings');
    expect(kinds).toContain('dispatch_review');
    expect(acts.find((a) => a.kind === 'apply_review_findings')?.data?.repoId).toBe('r1');
  });

  it('an in-flight pass suppresses BOTH apply and re-audit (nothing while a batch runs)', () => {
    const d = stateFinalizeOneCleanPass();
    (d.stages.spec.phases.finalize.auditPasses[0] as { audit: { attempts: { status: string }[] } }).audit.attempts.push({ status: 'running' });
    const manual = allowedActions(d, 'manual').map((a) => a.kind);
    expect(manual).not.toContain('apply_findings');
    expect(manual).not.toContain('dispatch_audit');
  });

  it('no duplicates when auto already offers dispatch_audit (fresh finalize, 0 passes)', () => {
    const d = stateFinalizeFresh();
    const manual = allowedActions(d, 'manual').map((a) => a.kind);
    expect(manual.filter((k) => k === 'dispatch_audit')).toHaveLength(1);
    // 0 passes → nothing to apply yet
    expect(manual).not.toContain('apply_findings');
  });
});
