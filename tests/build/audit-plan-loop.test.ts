// @vitest-environment node
import { runPlanAuditPass, planAuditHistory } from '@/build/audit-plan-loop';
import { createMockDb, seq } from '../test-utils/mock-db';
import { RecordingBus, FakeMma } from './fixtures';

function auditEnv(findings: Array<{ severity: string; claim: string }>) {
  return { headline: 'audit complete', structuredReport: { findings, findingsOutcome: findings.length ? 'found' : 'clean' } };
}

describe('runPlanAuditPass', () => {
  it('dispatches audit(subtype=plan) with exactly one filePaths entry', async () => {
    const db = createMockDb({
      'select:audit_pass': [],
      'insert:audit_pass': [{ id: 'pass-1', projectId: 'proj-1', scope: 'plan', passNo: 1, findingsCount: 0, verdict: 'clean', mmaBatchId: null, createdAt: new Date(), updatedAt: new Date() }],
      'select:action_log': [],
      'insert:action_log': [{ id: 'log-1', projectId: 'proj-1', memberId: 'member-1', action: 'audit_plan', target: 'pass:1', createdAt: new Date() }],
    });
    const mma = new FakeMma({ audit: [auditEnv([])] });
    const res = await runPlanAuditPass(
      { db, mma: mma as unknown as any, bus: new RecordingBus() },
      { projectId: 'proj-1', repoName: 'test-repo', repoCwd: '/work/a', planFilePath: '/work/a/.forge/plan-x.md', actorId: 'member-1' },
    );
    expect(res.verdict).toBe('clean');
    const body = mma.dispatches[0].body as { subtype: string; filePaths: string[] };
    expect(body.subtype).toBe('plan');
    expect(body.filePaths).toHaveLength(1);
  });

  it("clean (no critical/high) → verdict 'clean'; persists an audit_pass(scope='plan') row", async () => {
    const db = createMockDb({
      'select:audit_pass': [],
      'insert:audit_pass': [{ id: 'pass-1', projectId: 'proj-1', scope: 'plan', passNo: 1, findingsCount: 1, verdict: 'clean', mmaBatchId: null, createdAt: new Date(), updatedAt: new Date() }],
      'select:action_log': [],
      'insert:action_log': [{ id: 'log-1', projectId: 'proj-1', memberId: 'member-1', action: 'audit_plan', target: 'pass:1', createdAt: new Date() }],
    });
    const mma = new FakeMma({ audit: [auditEnv([{ severity: 'medium', claim: 'nit' }])] });
    const bus = new RecordingBus();
    const res = await runPlanAuditPass(
      { db, mma: mma as unknown as any, bus },
      { projectId: 'proj-1', repoName: 'test-repo', repoCwd: '/work/b', planFilePath: '/work/b/.forge/plan-x.md', actorId: 'member-1' },
    );
    expect(res.verdict).toBe('clean'); // medium does not block
    expect(res.findingsCount).toBe(1);
    expect(db._assertCalled('audit_pass', 'insert')).toBe(true);
    expect(bus.ofType('audit.pass')).toHaveLength(1);
  });

  it("critical/high → verdict 'revised' (blocking); surfaces blocking claims", async () => {
    const db = createMockDb({
      'select:audit_pass': [],
      'insert:audit_pass': [{ id: 'pass-1', projectId: 'proj-1', scope: 'plan', passNo: 1, findingsCount: 1, verdict: 'revised', mmaBatchId: null, createdAt: new Date(), updatedAt: new Date() }],
      'select:action_log': [],
      'insert:action_log': [{ id: 'log-1', projectId: 'proj-1', memberId: 'member-1', action: 'audit_plan', target: 'pass:1', createdAt: new Date() }],
    });
    const mma = new FakeMma({ audit: [auditEnv([{ severity: 'high', claim: 'symbol X does not exist' }])] });
    const res = await runPlanAuditPass(
      { db, mma: mma as unknown as any, bus: new RecordingBus() },
      { projectId: 'proj-1', repoName: 'test-repo', repoCwd: '/work/c', planFilePath: '/work/c/.forge/plan-x.md', actorId: 'member-1' },
    );
    expect(res.verdict).toBe('revised');
    expect(res.hasBlocking).toBe(true);
    expect(res.blockingClaims).toContain('symbol X does not exist');
  });

  it('history is ordered oldest-first across passes', async () => {
    const db = createMockDb({
      'select:audit_pass': seq(
        [],
        [{ id: 'pass-1', projectId: 'proj-1', scope: 'plan', passNo: 1, findingsCount: 1, verdict: 'revised', mmaBatchId: null, createdAt: new Date(), updatedAt: new Date() }],
        [
          { id: 'pass-1', projectId: 'proj-1', scope: 'plan', passNo: 1, findingsCount: 1, verdict: 'revised', mmaBatchId: null, createdAt: new Date(), updatedAt: new Date() },
          { id: 'pass-2', projectId: 'proj-1', scope: 'plan', passNo: 2, findingsCount: 0, verdict: 'clean', mmaBatchId: null, createdAt: new Date(), updatedAt: new Date() },
        ],
      ),
      'insert:audit_pass': [{ id: 'pass-1', projectId: 'proj-1', scope: 'plan', passNo: 1, findingsCount: 0, verdict: 'clean', mmaBatchId: null, createdAt: new Date(), updatedAt: new Date() }],
      'select:action_log': [],
      'insert:action_log': [{ id: 'log-1', projectId: 'proj-1', memberId: 'member-1', action: 'audit_plan', target: 'pass:1', createdAt: new Date() }],
    });
    const mma = new FakeMma({ audit: [auditEnv([{ severity: 'high', claim: 'x' }]), auditEnv([])] });
    const deps = { db, mma: mma as unknown as any, bus: new RecordingBus() };
    const args = { projectId: 'proj-1', repoName: 'test-repo', repoCwd: '/work/d', planFilePath: '/work/d/.forge/plan-x.md', actorId: 'member-1' };
    await runPlanAuditPass(deps, args);
    await runPlanAuditPass(deps, args);
    const hist = await planAuditHistory(db, 'proj-1');
    expect(hist.map((h) => h.verdict)).toEqual(['revised', 'clean']);
    expect(hist.map((h) => h.passNo)).toEqual([1, 2]);
  });
});
