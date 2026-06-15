// @vitest-environment node
import { afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { auditPass } from '@/db/schema/artifacts';
import { runPlanAuditPass, planAuditHistory } from '@/build/audit-plan-loop';
import { MmaClient } from '@/mma/client';
import { seedProject, seedRepo, cleanupBuildFixtures, RecordingBus, FakeMma } from './fixtures';

function auditEnv(findings: Array<{ severity: string; claim: string }>) {
  return { headline: 'audit complete', structuredReport: { findings, findingsOutcome: findings.length ? 'found' : 'clean' } };
}

// Live-DB integration suite — gated OFF: tests never touch a database (no test DB
// exists; production must not be mutated). See tests/setup.ts.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('runPlanAuditPass', () => {
  afterEach(cleanupBuildFixtures);

  it('dispatches audit(subtype=plan) with exactly one filePaths entry', async () => {
    const repo = await seedRepo('a', '/work/a');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const mma = new FakeMma({ audit: [auditEnv([])] });
    const res = await runPlanAuditPass(
      { db: getDb(), mma: mma as unknown as MmaClient, bus: new RecordingBus() },
      { projectId, repoName: repo.name, repoCwd: repo.pathOnDisk, planFilePath: '/work/a/.forge/plan-x.md', actorId: ownerId },
    );
    expect(res.verdict).toBe('clean');
    const body = mma.dispatches[0].body as { subtype: string; filePaths: string[] };
    expect(body.subtype).toBe('plan');
    expect(body.filePaths).toHaveLength(1);
  });

  it("clean (no critical/high) → verdict 'clean'; persists an audit_pass(scope='plan') row", async () => {
    const repo = await seedRepo('b', '/work/b');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const mma = new FakeMma({ audit: [auditEnv([{ severity: 'medium', claim: 'nit' }])] });
    const bus = new RecordingBus();
    const res = await runPlanAuditPass(
      { db: getDb(), mma: mma as unknown as MmaClient, bus },
      { projectId, repoName: repo.name, repoCwd: repo.pathOnDisk, planFilePath: '/work/b/.forge/plan-x.md', actorId: ownerId },
    );
    expect(res.verdict).toBe('clean'); // medium does not block
    expect(res.findingsCount).toBe(1);
    const rows = await getDb()
      .select()
      .from(auditPass)
      .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'plan')));
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('clean');
    expect(bus.ofType('audit.pass')).toHaveLength(1);
  });

  it("critical/high → verdict 'revised' (blocking); surfaces blocking claims", async () => {
    const repo = await seedRepo('c', '/work/c');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const mma = new FakeMma({ audit: [auditEnv([{ severity: 'high', claim: 'symbol X does not exist' }])] });
    const res = await runPlanAuditPass(
      { db: getDb(), mma: mma as unknown as MmaClient, bus: new RecordingBus() },
      { projectId, repoName: repo.name, repoCwd: repo.pathOnDisk, planFilePath: '/work/c/.forge/plan-x.md', actorId: ownerId },
    );
    expect(res.verdict).toBe('revised');
    expect(res.hasBlocking).toBe(true);
    expect(res.blockingClaims).toContain('symbol X does not exist');
  });

  it('history is ordered oldest-first across passes', async () => {
    const repo = await seedRepo('d', '/work/d');
    const { projectId, ownerId } = await seedProject({ repoIds: [repo.id] });
    const mma = new FakeMma({ audit: [auditEnv([{ severity: 'high', claim: 'x' }]), auditEnv([])] });
    const deps = { db: getDb(), mma: mma as unknown as MmaClient, bus: new RecordingBus() };
    const args = { projectId, repoName: repo.name, repoCwd: repo.pathOnDisk, planFilePath: '/work/d/.forge/plan-x.md', actorId: ownerId };
    await runPlanAuditPass(deps, args);
    await runPlanAuditPass(deps, args);
    const hist = await planAuditHistory(getDb(), projectId);
    expect(hist.map((h) => h.verdict)).toEqual(['revised', 'clean']);
    expect(hist.map((h) => h.passNo)).toEqual([1, 2]);
  });
});
