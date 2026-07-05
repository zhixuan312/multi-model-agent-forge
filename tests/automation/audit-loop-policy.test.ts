import { auditLoopStep, auditInFlight, AUDIT_PASS_CAP } from '@/automation/audit-loop-policy';

const pass = (o: Partial<{ passNo: number; status: string; auditRunning: boolean; fixDone: boolean }>) => ({
  passNo: o.passNo ?? 1,
  status: o.status ?? 'clean',
  audit: { attempts: [{ status: o.auditRunning ? 'running' : 'done' }] },
  fix: o.fixDone === undefined ? undefined : { attempts: [{ status: o.fixDone ? 'done' : 'running' }] },
});

describe('audit-loop policy (shared by finalize/validate/review)', () => {
  it('no passes → dispatch pass 1', () => {
    expect(auditLoopStep([])).toEqual({ kind: 'dispatch_audit', passNo: 1 });
  });
  it('a running audit → wait', () => {
    expect(auditLoopStep([pass({ auditRunning: true })])).toEqual({ kind: 'wait' });
    expect(auditInFlight([pass({ auditRunning: true })])).toBe(true);
  });
  it('revised + no fix yet → apply findings', () => {
    expect(auditLoopStep([pass({ passNo: 2, status: 'revised' })])).toEqual({ kind: 'apply_findings', passNo: 2 });
  });
  it('revised + fix done + under cap → next audit pass', () => {
    expect(auditLoopStep([pass({ status: 'revised', fixDone: true })])).toEqual({ kind: 'dispatch_audit', passNo: 2 });
  });
  it('clean → advance', () => {
    expect(auditLoopStep([pass({ status: 'clean', fixDone: true })])).toEqual({ kind: 'advance' });
  });
  it('AT THE CAP with fix applied → advance (never advance on an unfixed pass)', () => {
    const passes = Array.from({ length: AUDIT_PASS_CAP }, (_, i) => pass({ passNo: i + 1, status: 'revised', fixDone: true }));
    expect(auditLoopStep(passes)).toEqual({ kind: 'advance' });
  });
  it('AT THE CAP but last fix NOT applied → apply findings FIRST (the line-191 fix)', () => {
    // passes 1..CAP-1 fixed; the CAP-th pass is revised with NO fix attempt yet
    // (fixDone undefined → no fix attempt; a running fix would be `wait`, not apply).
    const passes = Array.from({ length: AUDIT_PASS_CAP }, (_, i) =>
      pass({ passNo: i + 1, status: 'revised', fixDone: i < AUDIT_PASS_CAP - 1 ? true : undefined }));
    expect(auditLoopStep(passes)).toEqual({ kind: 'apply_findings', passNo: AUDIT_PASS_CAP });
  });
});
