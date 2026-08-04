// @vitest-environment node
import {
  parseAuditEnvelope,
  nextPassNo,
  auditPassHistory,
} from '@/spec/audit-loop';
import { auditEnvelope } from './audit-envelope';
import { buildInitialDetails } from '@/details/schema';
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

  /**
   * An unrecognised LABEL is not an unrecognised FINDING. This used to `.filter()` the
   * finding out of the report entirely, so a claim the model actually wrote vanished from
   * the pass — the rail showed "1 finding" for an envelope carrying two, and the text of
   * the second was unrecoverable. `review-findings` had already answered this question the
   * other way (coerce to medium, keep it); the audit path now agrees.
   */
  it('keeps a finding whose severity label is out of set, as medium', () => {
    const env = auditEnvelope([{ severity: 'info', claim: 'i' }, { severity: 'high', claim: 'h' }]);
    const r = parseAuditEnvelope(env);
    if (r.kind !== 'report') throw new Error('unreachable');
    expect(r.findings.map((f) => f.claim)).toEqual(['i', 'h']);
    expect(r.findings.map((f) => f.severity)).toEqual(['medium', 'high']);
    // Coerced, so it is visible — but never promoted into the gate.
    expect(r.hasCriticalOrHigh).toBe(true);
    expect(parseAuditEnvelope(auditEnvelope([{ severity: 'info', claim: 'i' }])).kind).toBe('report');
    const only = parseAuditEnvelope(auditEnvelope([{ severity: 'info', claim: 'i' }]));
    if (only.kind !== 'report') throw new Error('unreachable');
    expect(only.hasCriticalOrHigh).toBe(false);
  });

  it('drops an entry carrying NO severity at all — that is a malformed object, not a label', () => {
    // The distinction matters: coercing `{}` would render an empty row in the rail.
    const r = parseAuditEnvelope(auditEnvelope([{ claim: 'no severity' } as never, { severity: 'low', claim: 'l' }]));
    if (r.kind !== 'report') throw new Error('unreachable');
    expect(r.findings.map((f) => f.claim)).toEqual(['l']);
  });

  /**
   * The sharpest form of the same bug, and the reason it was worth chasing: membership was
   * tested against the lowercase set with no normalisation, while `isBlockingSeverity`
   * downstream lower-cases. So a model that wrote `"weight": "Critical"` — ordinary
   * title-casing, and NOT rejected anywhere upstream because the string/fence path is not
   * schema-validated — had its finding deleted before the gate ever saw it, and
   * `hasCriticalOrHigh` came back false. **The audit reported CLEAN and the stage
   * advanced.** Case alone decided whether a critical finding gated the spec.
   */
  it.each(['Critical', 'CRITICAL', 'High', ' high '])('blocks on a %s finding, whatever its casing', (label) => {
    const r = parseAuditEnvelope(auditEnvelope([{ severity: label, claim: 'c' }]));
    if (r.kind !== 'report') throw new Error('unreachable');
    expect(r.findings).toHaveLength(1);
    expect(r.hasCriticalOrHigh, `"${label}" must not read as clean`).toBe(true);
  });

  it('surfaces a reusable contextBlockId when present', () => {
    const r = parseAuditEnvelope(auditEnvelope([], { contextBlockId: 'cb-42' }));
    if (r.kind !== 'report') throw new Error('unreachable');
    expect(r.contextBlockId).toBe('cb-42');
  });

  /**
   * The fixture emits `weight`, the key the engine actually sends. `severity` is accepted
   * as an alias and is asserted HERE, once and explicitly, rather than being the shape every
   * other case in the file happened to use — which is what left the real wire key covered
   * by a single describe block at the bottom.
   */
  it('reads the severity from either the `weight` wire key or a `severity` alias', () => {
    for (const key of ['weight', 'severity'] as const) {
      const r = parseAuditEnvelope(auditEnvelope([{ severity: 'high', claim: 'h' }], { key }));
      if (r.kind !== 'report') throw new Error(`${key} produced ${r.kind}`);
      expect(r.findings[0]!.severity, key).toBe('high');
      expect(r.hasCriticalOrHigh, key).toBe(true);
    }
  });
});

describe('nextPassNo', () => {
  it('returns 1 when no passes exist', async () => {
    const d = buildInitialDetails();
    const mockDb = createMockDb({ 'select:project': [{ details: d }] });
    expect(await nextPassNo(mockDb, 'proj-1')).toBe(1);
  });

  it('returns count+1 from details audit passes', async () => {
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

  /**
   * `appliedIndices` is what lets a stage mark ONLY the findings that were applied. Without
   * it the UI can express applied-ness only as a whole-round boolean, which greens findings
   * nobody applied and locks the round — so applying 2 of 5 stranded the other 3. Review
   * always derived this from the apply batches; the audit path recorded nothing, so the
   * dispatch now writes `passNo` + `findingIndices` and this reads them back.
   */
  describe('appliedIndices', () => {
    const AT = '2026-08-01T00:00:00.000Z';
    const envelope = (n: number) => ({
      output: { summary: { findings: Array.from({ length: n }, (_, i) => ({
        severity: 'high', category: 'gap', claim: `finding ${i}`, evidence: '', suggestion: '',
      })) } },
    });

    function dbWith(applyRequests: unknown[]) {
      const d = buildInitialDetails();
      d.stages.spec.phases.finalize.auditPasses = [
        { passNo: 1, status: 'revised', audit: { attempts: [{ batchId: 'b1', status: 'done', at: AT }] } },
      ] as never;
      return createMockDb({
        'select:project': [{ details: d }],
        // First batch read resolves the pass envelope; the second is the apply-batch scan.
        'select:ops_mma_batch': seq([{ id: 'b1', result: envelope(5) }], applyRequests.map((r) => ({ request: r }))),
      });
    }

    it('reports exactly the indices the apply batch recorded', async () => {
      const [pass] = await auditPassHistory(dbWith([{ passNo: 1, findingIndices: [0, 2] }]), 'p1');
      expect(pass.appliedIndices).toEqual([0, 2]);
      expect(pass.findings).toHaveLength(5);
    });

    it('unions and sorts across several partial applies of the same pass', async () => {
      const [pass] = await auditPassHistory(
        dbWith([{ passNo: 1, findingIndices: [3] }, { passNo: 1, findingIndices: [0, 3] }]), 'p1');
      expect(pass.appliedIndices).toEqual([0, 3]);
    });

    it('ignores batches for a DIFFERENT pass', async () => {
      const [pass] = await auditPassHistory(dbWith([{ passNo: 2, findingIndices: [1] }]), 'p1');
      expect(pass.appliedIndices).toEqual([]);
    });

    it('is empty when nothing was applied, so no row is falsely marked', async () => {
      const [pass] = await auditPassHistory(dbWith([]), 'p1');
      expect(pass.appliedIndices).toEqual([]);
    });

    it('tolerates a malformed request rather than throwing', async () => {
      const [pass] = await auditPassHistory(
        dbWith([{ passNo: 'one', findingIndices: 'nope' }, { passNo: 1, findingIndices: [4] }]), 'p1');
      expect(pass.appliedIndices).toEqual([4]);
    });
  });
});

/**
 * Regression: the audit gate used to strip ONLY a ```json-tagged fence, so a model that
 * emitted a bare ``` fence (or left whitespace after the closing one) produced no findings
 * — and `parseAuditEnvelope` reports "no findings" the same way whether the audit was clean
 * or the response was unreadable. A parse failure could therefore pass a stage.
 *
 * Both now route through `parseLlmJson`, so every fence shape yields the same findings.
 */
describe('parseAuditEnvelope — fence shapes must not change the verdict', () => {
  const report = { verdict: 'revised', findings: [{ weight: 'critical', category: 'gap', claim: 'Missing error path', evidence: 'e', suggestion: 's' }] };
  const body = JSON.stringify(report);

  const shapes: Array<[string, string]> = [
    ['no fence', body],
    ['```json fence', '```json\n' + body + '\n```'],
    ['BARE ``` fence', '```\n' + body + '\n```'],
    ['fence with trailing whitespace', '```json\n' + body + '\n```   \n'],
    ['prose before the fence', "Here's the audit:\n```json\n" + body + '\n```'],
  ];

  for (const [label, summary] of shapes) {
    it(`extracts the finding from: ${label}`, () => {
      const res = parseAuditEnvelope({ output: { summary } });
      expect(res.kind, `${label} produced ${res.kind}`).toBe('report');
      if (res.kind !== 'report') return;
      expect(res.findings).toHaveLength(1);
      expect(res.hasCriticalOrHigh).toBe(true);
    });
  }
});
