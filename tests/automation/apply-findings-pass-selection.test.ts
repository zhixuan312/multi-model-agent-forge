// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

// `vi.mock` is hoisted above top-level bindings, so the spy must be created inside
// `vi.hoisted` to exist by the time the factory runs.
const { dispatchMma } = vi.hoisted(() => ({ dispatchMma: vi.fn(async () => ({ batchRowId: 'b-new' })) }));
vi.mock('@/dispatch/dispatch-helpers', () => ({
  dispatchMma,
  findInflight: vi.fn(async () => null),
  PhaseBusyError: class extends Error {},
}));
vi.mock('@/details/write', () => ({
  updateDetails: vi.fn(async () => {}),
  advanceStage: vi.fn(async () => {}),
  advancePhase: vi.fn(async () => {}),
  reopenStage: vi.fn(async () => {}),
  setAutomationStatus: vi.fn(async () => {}),
}));
vi.mock('@/projects/project-files', () => ({
  specFilePath: vi.fn(async () => '/abs/spec.md'),
  planFilePath: vi.fn(async () => '/abs/plan.md'),
  readSpecFile: vi.fn(() => null),
  backupArtifact: vi.fn(async () => {}),
}));
vi.mock('@/mma/server-client', () => ({ buildMmaClient: vi.fn(async () => ({})) }));

import { executeDetailsAction } from '@/automation/details-actions';
import { buildInitialDetails } from '@/details/schema';
import { createMockDb, seq } from '../test-utils/mock-db';

/**
 * `findingIndices` are positions in ONE pass's parsed findings, and the client reads its
 * rows from `auditPassHistory`, which parses per pass. The audit rail lets a user select an
 * older round, so pinning the server to `passes[last]` meant indices chosen against pass N
 * were applied to pass M's findings — silently fixing the wrong things.
 */
function envelope(claims: string[]) {
  return {
    output: {
      summary: {
        findings: claims.map((c) => ({ severity: 'high', category: 'gap', claim: c, evidence: '', suggestion: '' })),
      },
    },
  };
}

const AT = '2026-08-01T00:00:00.000Z';

/** Two recorded audit passes, each pointing at its own batch envelope. */
function detailsWithTwoPasses() {
  const d = buildInitialDetails();
  d.stages.spec.status = 'active';
  d.stages.spec.phases.finalize.status = 'active';
  d.stages.spec.phases.finalize.auditPasses = [
    { passNo: 1, status: 'revised', audit: { attempts: [{ batchId: 'batch-1', status: 'done', at: AT }] }, fix: { attempts: [] } },
    { passNo: 2, status: 'revised', audit: { attempts: [{ batchId: 'batch-2', status: 'done', at: AT }] }, fix: { attempts: [] } },
  ] as never;
  return d;
}

const action = (data: Record<string, unknown>) => ({
  kind: 'apply_findings', note: 'Apply', stage: 'spec', phase: 'finalize', data,
}) as never;

/** Bound literal values inside a drizzle SQL node, found without walking into cycles. */
function collectParams(node: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth = 0): void => {
    if (v === null || v === undefined || depth > 8) return;
    if (typeof v !== 'object') { out.push(v); return; }
    if (seen.has(v)) return;
    seen.add(v);
    for (const child of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) visit(child, depth + 1);
  };
  visit(node);
  return out;
}

/** Which audit batch the handler actually looked up — the thing that identifies the pass. */
function queriedBatchIds(db: ReturnType<typeof createMockDb>): unknown[] {
  return db._callsFor('ops_mma_batch')
    .filter((c) => c.method === 'where')
    .flatMap((c) => collectParams(c.args[0]));
}

describe('apply_findings applies the pass the caller named', () => {
  beforeEach(() => dispatchMma.mockClear());

  function db() {
    return createMockDb({
      'select:project': [{ details: detailsWithTwoPasses(), detailsVersion: 1 }],
      // First read is the project row above; the next is the audit batch envelope. Pass 1
      // and pass 2 carry deliberately different findings so the prompt identifies the pass.
      'select:ops_mma_batch': seq([{ result: envelope(['FROM PASS ONE']) }], [{ result: envelope(['FROM PASS TWO']) }]),
    });
  }

  it('looks up pass 1\'s batch when passNo=1, not the latest pass\'s', async () => {
    // Assert the QUERIED batch id, not the returned rows: the mock serves canned data for
    // any id, so checking the resulting prompt would pass even with the bug present.
    const d = db();
    await executeDetailsAction('p1', action({ passNo: 1, findingIndices: [0] }), d);
    expect(queriedBatchIds(d)).toContain('batch-1');
    expect(queriedBatchIds(d)).not.toContain('batch-2');
  });

  it('falls back to the LATEST pass when no passNo is sent (auto mode / apply all)', async () => {
    const d = db();
    await executeDetailsAction('p1', action({ findingIndices: [0] }), d);
    expect(queriedBatchIds(d)).toContain('batch-2');
    expect(dispatchMma).toHaveBeenCalled();
  });

  it('does not dispatch for a passNo that does not exist', async () => {
    await executeDetailsAction('p1', action({ passNo: 99, findingIndices: [0] }), db());
    expect(dispatchMma).not.toHaveBeenCalled();
  });
});
