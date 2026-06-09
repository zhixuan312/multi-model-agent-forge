// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { auditPass } from '@/db/schema/artifacts';
import { actionLog } from '@/db/schema/audit';
import {
  AUDIT_PASS_CAP,
  parseAuditEnvelope,
  runAuditPass,
  AuditIncompleteError,
  nextPassNo,
  auditPassHistory,
  latestAuditPass,
} from '@/spec/audit-loop';
import { seedProject, cleanupSpecFixtures } from './db-fixtures';
import { mockMma, auditEnvelope, type RecordedDispatch } from './mock-mma';

afterAll(async () => {
  await cleanupSpecFixtures();
});

const db = getDb();
const WS_ROOT = '/forge-workspace-test-root';

describe('parseAuditEnvelope (pure)', () => {
  it('parses findings + flags critical/high', () => {
    const env = auditEnvelope([
      { severity: 'high', category: 'testability', claim: 'untestable requirement' },
      { severity: 'low', category: 'style', claim: 'nit' },
    ]);
    const r = parseAuditEnvelope(env);
    expect(r.kind).toBe('report');
    if (r.kind !== 'report') throw new Error('unreachable');
    expect(r.findings).toHaveLength(2);
    expect(r.hasCriticalOrHigh).toBe(true);
  });

  it('clean when only medium/low (no critical/high)', () => {
    const env = auditEnvelope([{ severity: 'medium', claim: 'm' }, { severity: 'low', claim: 'l' }]);
    const r = parseAuditEnvelope(env);
    if (r.kind !== 'report') throw new Error('unreachable');
    expect(r.hasCriticalOrHigh).toBe(false);
  });

  it('zero findings is a clean report (not missing)', () => {
    const r = parseAuditEnvelope(auditEnvelope([]));
    expect(r.kind).toBe('report');
    if (r.kind !== 'report') throw new Error('unreachable');
    expect(r.findings).toHaveLength(0);
    expect(r.hasCriticalOrHigh).toBe(false);
  });

  it('missing structuredReport → missing_report (F20)', () => {
    expect(parseAuditEnvelope({ headline: 'x' }).kind).toBe('missing_report');
    expect(parseAuditEnvelope({ headline: 'x', structuredReport: { kind: 'not_applicable' } }).kind).toBe(
      'missing_report',
    );
    expect(parseAuditEnvelope({ structuredReport: { findingsOutcome: 'not_applicable' } }).kind).toBe(
      'missing_report',
    );
  });

  it('drops findings with an out-of-set severity (e.g. info)', () => {
    const env = auditEnvelope([{ severity: 'info', claim: 'i' }, { severity: 'high', claim: 'h' }]);
    const r = parseAuditEnvelope(env);
    if (r.kind !== 'report') throw new Error('unreachable');
    expect(r.findings.map((f) => f.severity)).toEqual(['high']);
  });

  it('surfaces a reusable contextBlockId when present', () => {
    const r = parseAuditEnvelope(auditEnvelope([], { contextBlockId: 'cb-42' }));
    if (r.kind !== 'report') throw new Error('unreachable');
    expect(r.contextBlockId).toBe('cb-42');
  });
});

describe('runAuditPass (live DB + mock MMA)', () => {
  it('writes a revised audit_pass on critical/high + logs an audit action, cwd=workspace root', async () => {
    const { projectId, ownerId } = await seedProject();
    const calls: RecordedDispatch[] = [];
    const mma = mockMma({
      envelopes: { audit: [auditEnvelope([{ severity: 'critical', claim: 'bad' }])] },
      calls,
    });

    const res = await runAuditPass(
      { db, mma, workspaceRoot: WS_ROOT },
      { projectId, specMd: '# spec', actorId: ownerId },
    );

    expect(res.verdict).toBe('revised');
    expect(res.passNo).toBe(1);
    expect(res.findingsCount).toBe(1);

    // cwd MUST be the workspace root; body carries subtype + document.
    expect(calls[0].route).toBe('audit');
    expect(calls[0].cwd).toBe(WS_ROOT);
    expect(calls[0].body).toMatchObject({ subtype: 'spec', document: '# spec' });

    const rows = await db
      .select()
      .from(auditPass)
      .where(and(eq(auditPass.projectId, projectId), eq(auditPass.scope, 'spec')));
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('revised');

    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'audit')));
    expect(logs).toHaveLength(1);
    expect(logs[0].target).toBe('pass:1');
  });

  it('writes a clean audit_pass when no critical/high', async () => {
    const { projectId, ownerId } = await seedProject();
    const mma = mockMma({ envelopes: { audit: [auditEnvelope([{ severity: 'medium', claim: 'm' }])] } });
    const res = await runAuditPass(
      { db, mma, workspaceRoot: WS_ROOT },
      { projectId, specMd: '# spec', actorId: ownerId },
    );
    expect(res.verdict).toBe('clean');
    const latest = await latestAuditPass(db, projectId);
    expect(latest?.verdict).toBe('clean');
  });

  it('monotonic pass_no across runs (max+1), may exceed the cap', async () => {
    const { projectId, ownerId } = await seedProject();
    // Five separate user-initiated passes (each a fresh run).
    for (let i = 0; i < 5; i += 1) {
      const mma = mockMma({ envelopes: { audit: [auditEnvelope([{ severity: 'high', claim: 'h' }])] } });
      const r = await runAuditPass(
        { db, mma, workspaceRoot: WS_ROOT },
        { projectId, specMd: '# spec', actorId: ownerId },
      );
      expect(r.passNo).toBe(i + 1);
    }
    // pass_no legitimately exceeds AUDIT_PASS_CAP (the cap bounds per-run index, not pass_no).
    expect(await nextPassNo(db, projectId)).toBe(6);
    expect(6).toBeGreaterThan(AUDIT_PASS_CAP);

    const history = await auditPassHistory(db, projectId);
    expect(history.map((h) => h.passNo)).toEqual([1, 2, 3, 4, 5]);
  });

  it('missing report → AuditIncompleteError, NO audit_pass row, retryable (F20)', async () => {
    const { projectId, ownerId } = await seedProject();
    const mma = mockMma({ envelopes: { audit: [{ headline: 'auditor crashed' }] } });
    await expect(
      runAuditPass({ db, mma, workspaceRoot: WS_ROOT }, { projectId, specMd: '# spec', actorId: ownerId }),
    ).rejects.toBeInstanceOf(AuditIncompleteError);

    const rows = await db
      .select()
      .from(auditPass)
      .where(eq(auditPass.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it('hung 202 batch → wait timeout, NO audit_pass row', async () => {
    const { projectId, ownerId } = await seedProject();
    const mma = mockMma({ envelopes: { audit: [auditEnvelope([])] }, hang: new Set(['audit']) });
    await expect(
      runAuditPass({ db, mma, workspaceRoot: WS_ROOT }, { projectId, specMd: '# spec', actorId: ownerId }),
    ).rejects.toThrow(/terminal/i);
    const rows = await db.select().from(auditPass).where(eq(auditPass.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it('forwards contextBlockIds on a re-audit', async () => {
    const { projectId, ownerId } = await seedProject();
    const calls: RecordedDispatch[] = [];
    const mma = mockMma({ envelopes: { audit: [auditEnvelope([])] }, calls });
    await runAuditPass(
      { db, mma, workspaceRoot: WS_ROOT },
      { projectId, specMd: '# spec', actorId: ownerId, contextBlockIds: ['cb-1'] },
    );
    expect((calls[0].body as { contextBlockIds?: string[] }).contextBlockIds).toEqual(['cb-1']);
  });
});
