// @vitest-environment node
import {
  parseAuditEnvelope,
  nextPassNo,
  auditPassHistory,

} from '@/spec/audit-loop';
import { auditEnvelope } from './mock-mma';
import { createMockDb, seq } from '../test-utils/mock-db';

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

  it('missing output.summary → missing_report (F20)', () => {
    expect(parseAuditEnvelope({}).kind).toBe('missing_report');
    expect(parseAuditEnvelope({ output: {} }).kind).toBe('missing_report');
    expect(parseAuditEnvelope({ output: { summary: { kind: 'not_applicable' } } }).kind).toBe(
      'missing_report',
    );
    expect(parseAuditEnvelope({ output: { summary: { findingsOutcome: 'not_applicable' } } }).kind).toBe(
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

describe('nextPassNo', () => {
  it('returns 1 when no passes exist', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const d = buildInitialDetails();
    const mockDb = createMockDb({ 'select:project': [{ details: d }] });
    expect(await nextPassNo(mockDb, 'proj-1')).toBe(1);
  });

  it('returns count+1 from details audit passes', async () => {
    const { buildInitialDetails } = await import('@/details/schema');
    const d = buildInitialDetails();
    d.stages.spec.phases.finalize.auditPasses = [
      { passNo: 1, status: 'revised', audit: { attempts: [{ batchId: 'a1', status: 'done', at: '' }] } },
      { passNo: 2, status: 'revised', audit: { attempts: [{ batchId: 'a2', status: 'done', at: '' }] } },
      { passNo: 3, status: 'clean', audit: { attempts: [{ batchId: 'a3', status: 'done', at: '' }] } },
    ];
    const mockDb = createMockDb({ 'select:project': [{ details: d }] });
    expect(await nextPassNo(mockDb, 'proj-1')).toBe(4);
  });
});

describe('auditPassHistory', () => {
  it('returns empty for a project with no passes', async () => {
    const mockDb = createMockDb({
      'select:project_audit_pass': [],
      'select:ops_mma_batch': [],
    });
    const history = await auditPassHistory(mockDb, 'proj-1');
    expect(history).toEqual([]);
  });
});
