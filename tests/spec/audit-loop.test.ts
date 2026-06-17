// @vitest-environment node
import { and, eq } from 'drizzle-orm';
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
import { mockMma, auditEnvelope, type RecordedDispatch } from './mock-mma';
import { createMockDb, seq } from '../test-utils/mock-db';

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
  it('writes a revised project_audit_pass on critical/high + logs an audit action, cwd=workspace root', async () => {
    const projectId = 'proj-1';
    const ownerId = 'owner-1';
    const calls: RecordedDispatch[] = [];
    const mockDb = createMockDb({
      'select:project_audit_pass': [],
      'insert:project_audit_pass': [{ id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'revised', findingsCount: 1 }],
      'insert:ops_action_log': [{ id: 'log-1', projectId, action: 'audit', target: 'pass:1' }],
    });

    const mma = mockMma({
      envelopes: { audit: [auditEnvelope([{ severity: 'critical', claim: 'bad' }])] },
      calls,
    });

    const res = await runAuditPass(
      { db: mockDb, mma, workspaceRoot: WS_ROOT },
      { projectId, specMd: '# spec', actorId: ownerId },
    );

    expect(res.verdict).toBe('revised');
    expect(res.passNo).toBe(1);
    expect(res.findingsCount).toBe(1);
    expect(calls[0].route).toBe('audit');
    expect(calls[0].cwd).toBe(WS_ROOT);
    expect(calls[0].body).toMatchObject({ subtype: 'spec', document: '# spec' });
  });

  it('writes a clean project_audit_pass when no critical/high', async () => {
    const projectId = 'proj-2';
    const ownerId = 'owner-2';
    const mockDb = createMockDb({
      'select:project_audit_pass': [],
      'insert:project_audit_pass': [{ id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'clean', findingsCount: 0 }],
      'insert:ops_action_log': [{ id: 'log-1', projectId, action: 'audit' }],
    });

    const mma = mockMma({ envelopes: { audit: [auditEnvelope([{ severity: 'medium', claim: 'm' }])] } });
    const res = await runAuditPass(
      { db: mockDb, mma, workspaceRoot: WS_ROOT },
      { projectId, specMd: '# spec', actorId: ownerId },
    );
    expect(res.verdict).toBe('clean');
  });

  it('monotonic pass_no across runs (max+1), may exceed the cap', async () => {
    const projectId = 'proj-3';
    const ownerId = 'owner-3';

    const mockDb = createMockDb({
      'select:project_audit_pass': seq(
        [{ m: 0 }],
        [{ m: 1 }],
        [{ m: 2 }],
        [{ m: 3 }],
        [{ m: 4 }],
        [{ m: 5 }],
        [
          { id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'revised' },
          { id: 'pass-2', projectId, scope: 'spec', passNo: 2, verdict: 'revised' },
          { id: 'pass-3', projectId, scope: 'spec', passNo: 3, verdict: 'revised' },
          { id: 'pass-4', projectId, scope: 'spec', passNo: 4, verdict: 'revised' },
          { id: 'pass-5', projectId, scope: 'spec', passNo: 5, verdict: 'revised' },
        ],
      ),
      'insert:project_audit_pass': [
        { id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'revised' },
        { id: 'pass-2', projectId, scope: 'spec', passNo: 2, verdict: 'revised' },
        { id: 'pass-3', projectId, scope: 'spec', passNo: 3, verdict: 'revised' },
        { id: 'pass-4', projectId, scope: 'spec', passNo: 4, verdict: 'revised' },
        { id: 'pass-5', projectId, scope: 'spec', passNo: 5, verdict: 'revised' },
      ],
      'insert:ops_action_log': [
        { id: 'log-1', projectId, action: 'audit' },
        { id: 'log-2', projectId, action: 'audit' },
        { id: 'log-3', projectId, action: 'audit' },
        { id: 'log-4', projectId, action: 'audit' },
        { id: 'log-5', projectId, action: 'audit' },
      ],
    });

    for (let i = 0; i < 5; i += 1) {
      const mma = mockMma({ envelopes: { audit: [auditEnvelope([{ severity: 'high', claim: 'h' }])] } });
      const r = await runAuditPass(
        { db: mockDb, mma, workspaceRoot: WS_ROOT },
        { projectId, specMd: '# spec', actorId: ownerId },
      );
      expect(r.passNo).toBe(i + 1);
    }
    expect(await nextPassNo(mockDb, projectId)).toBe(6);
    expect(6).toBeGreaterThan(AUDIT_PASS_CAP);
    const history = await auditPassHistory(mockDb, projectId);
    expect(history.map((h) => h.passNo)).toEqual([1, 2, 3, 4, 5]);
  });

  it('missing report → AuditIncompleteError, NO project_audit_pass row, retryable (F20)', async () => {
    const projectId = 'proj-4';
    const ownerId = 'owner-4';
    const mockDb = createMockDb({
      'select:project_audit_pass': [],
      'insert:project_audit_pass': [],
    });

    const mma = mockMma({ envelopes: { audit: [{ headline: 'auditor crashed' }] } });
    await expect(
      runAuditPass({ db: mockDb, mma, workspaceRoot: WS_ROOT }, { projectId, specMd: '# spec', actorId: ownerId }),
    ).rejects.toBeInstanceOf(AuditIncompleteError);
  });

  it('hung 202 batch → wait timeout, NO project_audit_pass row', async () => {
    const projectId = 'proj-5';
    const ownerId = 'owner-5';
    const mockDb = createMockDb({
      'select:project_audit_pass': [],
    });

    const mma = mockMma({ envelopes: { audit: [auditEnvelope([])] }, hang: new Set(['audit']) });
    await expect(
      runAuditPass({ db: mockDb, mma, workspaceRoot: WS_ROOT }, { projectId, specMd: '# spec', actorId: ownerId }),
    ).rejects.toThrow(/terminal/i);
  });

  it('forwards contextBlockIds on a re-audit', async () => {
    const projectId = 'proj-6';
    const ownerId = 'owner-6';
    const calls: RecordedDispatch[] = [];
    const mockDb = createMockDb({
      'select:project_audit_pass': [],
      'insert:project_audit_pass': [{ id: 'pass-1', projectId, scope: 'spec', passNo: 1, verdict: 'clean' }],
      'insert:ops_action_log': [{ id: 'log-1', projectId, action: 'audit' }],
    });

    const mma = mockMma({ envelopes: { audit: [auditEnvelope([])] }, calls });
    await runAuditPass(
      { db: mockDb, mma, workspaceRoot: WS_ROOT },
      { projectId, specMd: '# spec', actorId: ownerId, contextBlockIds: ['cb-1'] },
    );
    expect((calls[0].body as { contextBlockIds?: string[] }).contextBlockIds).toEqual(['cb-1']);
  });
});
