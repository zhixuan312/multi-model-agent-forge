// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { dispatchMma, findInflight, PhaseBusyError } from '@/dispatch/dispatch-helpers';
import { appendBatchTerminalEvent, phaseKeyForHandler, SINGLETON_HANDLERS } from '@/details/project-event-labels';
import { registerHandler } from '@/dispatch/handler-registry';
import type { MmaClient } from '@/mma/client';
import { createMockDb } from '../test-utils/mock-db';

// Stub the PollManager and activity functions so they don't construct real dependencies.
const { registerMock, recordActivity, resolveRunningActivity } = vi.hoisted(() => ({
  registerMock: vi.fn(),
  recordActivity: vi.fn(async () => {}),
  resolveRunningActivity: vi.fn(async () => {}),
}));
vi.mock('@/sse/poll-manager', () => ({ getPollManager: () => ({ register: registerMock }) }));
vi.mock('@/activity/project-activity', () => ({
  recordActivity,
  resolveRunningActivity,
}));

/**
 * G2 — per-(project, phase) single-flight. A dispatch is REFUSED (PhaseBusyError)
 * only when an in-flight batch belongs to a DIFFERENT phase; same-phase (fan-out)
 * is always allowed. The phase of a handler is `phaseKeyForHandler`.
 */
describe('G2 — per-(project, phase) concurrency guard', () => {
  it('phaseKeyForHandler groups handlers by their pipeline phase', () => {
    // same phase (plan/validate) → same key → NOT a conflict (audit↔apply loop)
    expect(phaseKeyForHandler('plan-audit')).toBe('plan/validate');
    expect(phaseKeyForHandler('plan-audit-apply')).toBe('plan/validate');
    // different phases → different keys → a conflict
    expect(phaseKeyForHandler('code-review')).toBe('review/review');
    expect(phaseKeyForHandler('plan-author')).toBe('plan/refine');
    // unknown / phase-less handler → null (guard skipped, e.g. global journal-recall)
    expect(phaseKeyForHandler('journal-recall')).toBeNull();
    expect(phaseKeyForHandler(null)).toBeNull();
  });

  it('dispatchMma REFUSES a cross-phase dispatch while another phase is in flight', async () => {
    // in-flight code-review (review/review); dispatching plan-audit (plan/validate)
    const db = createMockDb({
      'select:project': [{ teamId: 'team-1' }],
      'select:ops_mma_batch': [{ handler: 'code-review' }], // the guard's in-flight query
      'insert:ops_mma_batch': [{ id: 'row-x', createdAt: new Date() }],
    });
    await expect(dispatchMma({
      db, mma: { dispatchAndWait: async () => ({ batchId: 'm', envelope: { error: null } }) } as unknown as MmaClient,
      projectId: 'p', route: 'audit', handler: 'plan-audit', cwd: '/w', body: { prompt: 'x' }, actorId: null, await: true,
    })).rejects.toBeInstanceOf(PhaseBusyError);
  });
});

/**
 * Single-flight guard: findInflight WITHOUT a handler is the project-level check the
 * driver uses to guarantee at most one MMA request in flight per project at any time
 * (the pipeline is strictly sequential). With a handler it's the classic per-handler
 * check the manual routes use.
 */
describe('findInflight — project-level single-flight (handler omitted)', () => {
  it('returns an in-flight batch for the project regardless of its handler', async () => {
    // a plan-author batch is in flight; the project-level call (no handler arg) sees it
    const db = createMockDb({ 'select:ops_mma_batch': [{ id: 'b1', batchId: null, createdAt: new Date(), route: 'orchestrate', handler: 'plan-author' }] });
    expect(await findInflight(db, 'proj-1')).toBe('b1');
  });

  it('returns null when nothing is in flight', async () => {
    const db = createMockDb({ 'select:ops_mma_batch': [] });
    expect(await findInflight(db, 'proj-1')).toBeNull();
  });
});

/**
 * Regression: the SYNC-path terminal handler must receive `ctx.request` = body + meta
 * MERGED — the same shape persisted to the batch row and rehydrated by the async
 * PollManager path. Before the fix the sync path passed bare `opts.body`, so a handler
 * that keys off a `meta` field (e.g. plan-refine's `taskId`, used in a WHERE clause)
 * got `undefined` → "UNDEFINED_VALUE" → threw → the driver failed the whole run.
 */
describe('dispatchMma — sync handler receives body + meta merged as request', () => {
  it('merges meta (e.g. taskId) into ctx.request, not just body', async () => {
    const { registerHandler } = await import('@/dispatch/handler-registry');
    let seen: unknown = null;
    registerHandler('test-capture-request', async (_db, ctx) => { seen = ctx.request; });

    const db = createMockDb({
      'select:project': [{ teamId: 'team-1' }],
      'insert:ops_mma_batch': [{ id: 'row-c', createdAt: new Date() }],
    });
    await dispatchMma({
      db,
      mma: { dispatchAndWait: async () => ({ batchId: 'm', envelope: { error: null } }) } as unknown as MmaClient,
      projectId: 'p', route: 'orchestrate', handler: 'test-capture-request',
      cwd: '/w', body: { prompt: 'x' }, meta: { taskId: 'task-42' },
      actorId: '00000000-0000-0000-0000-000000000000', await: true,
    });

    expect(seen).toEqual({ prompt: 'x', taskId: 'task-42' });
  });
});

/**
 * Regression: a SYNC (`await: true`) dispatch must persist the MMA task id into
 * `ops_mma_batch.batch_id`. Before the fix, the sync path stored status/result/
 * usage but never the MMA task id, so every automation dispatch row had a NULL
 * `batch_id` and could not be traced back to the MMA task in MMA's own logs.
 */
describe('dispatchMma — sync path persists the MMA task id', () => {
  function fakeMma(env: unknown, mmaTaskId: string): MmaClient {
    return {
      dispatchAndWait: async () => ({ batchId: mmaTaskId, envelope: env }),
    } as unknown as MmaClient;
  }

  const terminalEnvelope = {
    task: { type: 'orchestrate', status: 'done', taskId: 'mma-task-99' },
    output: { summary: 'done', filesChanged: [] },
    metrics: {},
    error: null,
  };

  it('sets batchId (MMA task id) on the ops_mma_batch row after a sync dispatch', async () => {
    // A batch-backed sync dispatch REQUIRES a registered terminal handler (an
    // unregistered one now throws — it would otherwise record no gating state and
    // re-dispatch forever). Register a no-op so this test isolates batchId persistence.
    registerHandler('test-noop-handler', async () => {});
    const db = createMockDb({
      'select:project': [{ teamId: 'team-1' }],
      'insert:ops_mma_batch': [{ id: 'row-1', createdAt: new Date() }],
    });

    const res = await dispatchMma({
      db,
      mma: fakeMma(terminalEnvelope, 'mma-task-99'),
      projectId: 'proj-1',
      route: 'orchestrate',
      handler: 'test-noop-handler',
      cwd: '/w',
      body: { prompt: 'x' },
      actorId: '00000000-0000-0000-0000-000000000000',
      await: true,
    });

    expect(res.batchRowId).toBe('row-1');

    // Find the UPDATE ...set(...) call on ops_mma_batch and assert it carried batchId.
    const setCalls = db._callsFor('ops_mma_batch').filter((c) => c.method === 'set');
    expect(setCalls.length).toBeGreaterThan(0);
    const setArg = setCalls[0].args[0] as Record<string, unknown>;
    expect(setArg.status).toBe('done');
    expect(setArg.batchId).toBe('mma-task-99');
  });
});

/**
 * Robustness: an MMA task that RAN but FAILED carries a non-null `error` object in
 * its terminal envelope (e.g. `reviewer_parse_failed` from a provider 401). The
 * sync path must mark the row `failed` and THROW — so the caller's retry/stop logic
 * engages. Before the fix it stored `done` and swallowed the handler throw, so an
 * audit that never recorded a pass made the resolver re-dispatch "pass 1" forever.
 */
describe('dispatchMma — error envelope is a failure, not a silent success', () => {
  function fakeMma(env: unknown): MmaClient {
    return { dispatchAndWait: async () => ({ batchId: 'mma-err-1', envelope: env }) } as unknown as MmaClient;
  }

  const erroredEnvelope = {
    task: { type: 'audit', status: 'error', taskId: 'mma-err-1' },
    output: { summary: 'Failed to authenticate. API Error: 401 Invalid authentication credentials' },
    metrics: {},
    error: { code: 'reviewer_parse_failed', message: 'No JSON found in reviewer output' },
  };

  it('marks the row failed and throws when the envelope carries an error', async () => {
    const db = createMockDb({
      'select:project': [{ teamId: 'team-1' }],
      'insert:ops_mma_batch': [{ id: 'row-e', createdAt: new Date() }],
    });

    await expect(dispatchMma({
      db, mma: fakeMma(erroredEnvelope), projectId: 'proj-1', route: 'audit',
      handler: 'plan-audit', cwd: '/w', body: { prompt: 'x' },
      actorId: '00000000-0000-0000-0000-000000000000', await: true,
    })).rejects.toThrow(/reviewer_parse_failed/);

    const setCalls = db._callsFor('ops_mma_batch').filter((c) => c.method === 'set');
    const statuses = setCalls.map((c) => (c.args[0] as Record<string, unknown>).status);
    expect(statuses).toContain('failed');
    expect(statuses).not.toContain('done'); // never recorded as success
  });
});

/**
 * F1 regression: a terminal handler that THROWS on an otherwise-successful envelope
 * (e.g. an audit that returns prose → the handler throws `missing_report`) must mark
 * the batch `failed` and RETHROW — NOT swallow it and leave the batch `done`. The
 * swallow left the gate unwritten → the resolver re-dispatched forever (the driver's
 * retry bound never engaged because dispatchMma reported success).
 */
describe('dispatchMma — a throwing terminal handler fails the batch + rethrows', () => {
  const okEnvelope = {
    task: { type: 'audit', status: 'done', taskId: 'mma-ok' },
    output: { summary: 'plain prose, no structured report' },
    error: null,
  };

  it('marks the row failed and rethrows when the sync handler throws', async () => {
    const { registerHandler } = await import('@/dispatch/handler-registry');
    registerHandler('test-throwing-handler', async () => { throw new Error('handler boom'); });

    const db = createMockDb({
      'select:project': [{ teamId: 'team-1' }],
      'insert:ops_mma_batch': [{ id: 'row-h', createdAt: new Date() }],
    });
    await expect(dispatchMma({
      db,
      mma: { dispatchAndWait: async () => ({ batchId: 'mma-ok', envelope: okEnvelope }) } as unknown as MmaClient,
      projectId: 'proj-1', route: 'orchestrate', handler: 'test-throwing-handler',
      cwd: '/w', body: { prompt: 'x' }, actorId: '00000000-0000-0000-0000-000000000000', await: true,
    })).rejects.toThrow(/handler boom/);

    const statuses = db._callsFor('ops_mma_batch').filter((c) => c.method === 'set').map((c) => (c.args[0] as Record<string, unknown>).status);
    expect(statuses).toContain('failed'); // batch flipped done→failed on the handler throw
  });
});

/**
 * F1 regression: a batch-backed sync dispatch whose terminal handler is NOT registered
 * must FAIL LOUDLY (mark failed + throw) rather than silently skip. A skipped handler
 * records no gating state, so the batch reaches `done` with nothing written and the
 * WAITing resolver re-dispatches forever — the exact infinite loop the fix closes.
 */
describe('dispatchMma — an unregistered terminal handler fails the batch + throws', () => {
  const okEnvelope = {
    task: { type: 'audit', status: 'done', taskId: 'mma-ok' },
    output: { summary: { findings: [] } },
    error: null,
  };

  it('marks the row failed and throws when no handler is registered for the batch', async () => {
    const db = createMockDb({
      'select:project': [{ teamId: 'team-1' }],
      'insert:ops_mma_batch': [{ id: 'row-nh', createdAt: new Date() }],
    });
    await expect(dispatchMma({
      db,
      mma: { dispatchAndWait: async () => ({ batchId: 'mma-ok', envelope: okEnvelope }) } as unknown as MmaClient,
      projectId: 'proj-1', route: 'orchestrate', handler: 'totally-unregistered-handler',
      cwd: '/w', body: { prompt: 'x' }, actorId: '00000000-0000-0000-0000-000000000000', await: true,
    })).rejects.toThrow(/No terminal handler registered/);

    const statuses = db._callsFor('ops_mma_batch').filter((c) => c.method === 'set').map((c) => (c.args[0] as Record<string, unknown>).status);
    expect(statuses).toContain('failed');
  });
});

/**
 * R1 inline-consume contract (AC1): a sync dispatch with `handler: null` runs NO
 * terminal handler and does NOT throw — the caller reads the returned envelope. This
 * is the sanctioned path for project-less/handler-less callers (loops, recall sync).
 * The `label` still lands on the row for tracing.
 */
describe('dispatchMma — inline-consume (handler:null) [AC1]', () => {
  const okEnvelope = { task: { type: 'delegate', status: 'done', taskId: 'm' }, output: { summary: 'x' }, error: null };

  it('returns the envelope, marks the row done, fires no handler, and does not throw', async () => {
    const db = createMockDb({
      'select:loop_run': [{ teamId: 'team-1' }],
      'insert:ops_mma_batch': [{ id: 'row-ic', createdAt: new Date() }],
    });
    const res = await dispatchMma({
      db,
      mma: { dispatchAndWait: async () => ({ batchId: 'm', envelope: okEnvelope }) } as unknown as MmaClient,
      projectId: null, route: 'delegate', handler: null, label: 'loop-work',
      cwd: '/w', body: { prompt: 'x' }, actorId: null, loopRunId: 'loop-run-1', await: true,
    });
    expect((res.envelope as { output: unknown }).output).toBeTruthy();
    const setCalls = db._callsFor('ops_mma_batch').filter((c) => c.method === 'set').map((c) => c.args[0] as Record<string, unknown>);
    expect(setCalls.some((a) => a.status === 'done')).toBe(true);
    expect(setCalls.some((a) => a.status === 'failed')).toBe(false); // no missing-handler throw
  });
});

describe('dispatchMma — teamId resolution for project-less dispatches', () => {
  it('resolves teamId from the dispatching member for project-less async work', async () => {
    registerMock.mockClear();
    const db = createMockDb({
      'select:team_member': [{ teamId: 'team-1' }],
      'insert:ops_mma_batch': [{ id: 'row-fp', createdAt: new Date() }],
    });

    await dispatchMma({
      db,
      mma: { dispatch: async () => ({ batchId: 'ext-1' }) } as unknown as MmaClient,
      projectId: null,
      route: 'journal_recall',
      handler: null,
      label: 'journal-recall',
      cwd: '/w',
      body: {},
      actorId: 'member-1',
      await: false,
    });

    const valuesCall = db._callsFor('ops_mma_batch').find((c) => c.method === 'values');
    expect((valuesCall?.args[0] as Record<string, unknown>).teamId).toBe('team-1');
  });

  it('fails closed when teamId cannot be resolved', async () => {
    const db = createMockDb({ 'insert:ops_mma_batch': [{ id: 'row-miss', createdAt: new Date() }] });

    await expect(dispatchMma({
      db,
      mma: { dispatch: async () => ({ batchId: 'ext-1' }) } as unknown as MmaClient,
      projectId: null,
      route: 'journal_recall',
      handler: null,
      label: 'journal-recall',
      cwd: '/w',
      body: {},
      actorId: null,
      await: false,
    })).rejects.toThrow(/teamId/);
  });
});

/**
 * R1 (AC3): async dispatch (`await:false`) with `handler:null` is **fire-and-row-poll**:
 * it dispatches, registers with the PollManager (which persists the terminal envelope
 * on the row for an external poller to read), runs NO terminal handler, and returns the
 * external MMA `batchId`. This is the journal-recall shape.
 */
describe('dispatchMma — async + handler:null is fire-and-row-poll [AC3]', () => {
  it('dispatches, registers the poller, returns the external batchId, and runs no handler', async () => {
    registerMock.mockClear();
    const db = createMockDb({
      'select:team_member': [{ teamId: 'team-1' }],
      'insert:ops_mma_batch': [{ id: 'row-fp', createdAt: new Date() }],
    });
    const res = await dispatchMma({
      db, mma: { dispatch: async () => ({ batchId: 'ext-1' }) } as unknown as MmaClient,
      projectId: null, route: 'journal_recall', handler: null, label: 'journal-recall',
      cwd: '/w', body: {}, actorId: 'm1', await: false,
    });
    expect(res.batchRowId).toBe('row-fp');
    expect(res.batchId).toBe('ext-1'); // widened return — the row-poller keys off it
    expect(registerMock).toHaveBeenCalled();
  });

  it('threads taskId to the PollManager register (R4 discover fan-out)', async () => {
    registerMock.mockClear();
    const db = createMockDb({
      'select:project': [{ teamId: 'team-1' }],
      'insert:ops_mma_batch': [{ id: 'row-d', createdAt: new Date() }],
    });
    await dispatchMma({
      db, mma: { dispatch: async () => ({ batchId: 'ext-d' }) } as unknown as MmaClient,
      projectId: 'proj-1', route: 'investigate', handler: null, label: 'discover-investigate',
      cwd: '/w', body: { prompt: 'q' }, actorId: 'm1', taskId: 'task-0', await: false,
    });
    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-0', batchId: 'row-d', mmaBatchId: 'ext-d' }));
  });
});

describe('dispatchMma activity integration', () => {
  it('creates a running row for tracked handlers including spec-auto-draft', async () => {
    recordActivity.mockClear();
    // Register a no-op handler to prevent the real handler from running
    const { registerHandler } = await import('@/dispatch/handler-registry');
    registerHandler('spec-auto-draft', async () => {});

    const db = createMockDb({
      'select:project': [{ teamId: 'team-1' }],
      'select:ops_mma_batch': [],
      'insert:ops_mma_batch': [{ id: 'batch-row-1', createdAt: new Date('2026-07-10T00:00:00.000Z') }],
    });
    await dispatchMma({
      db,
      mma: { dispatchAndWait: async () => ({ batchId: 'mma-1', envelope: { error: null } }) } as unknown as MmaClient,
      projectId: 'proj-1',
      route: 'spec',
      handler: 'spec-auto-draft',
      cwd: '/tmp',
      body: { prompt: 'draft' },
      actorId: '00000000-0000-0000-0000-000000000000',
      await: true,
    });
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      label: 'Drafted spec',
      kind: 'running',
      source: 'mma',
      eventKey: 'spec-auto-draft:batch-row-1',
    }));
  });

  it('resolves tracked terminal rows by batch row id', async () => {
    resolveRunningActivity.mockClear();
    const db = createMockDb();
    await appendBatchTerminalEvent(db, 'proj-1', 'plan-author', 'batch-row-9', 'done', 4400);
    expect(resolveRunningActivity).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      eventKey: 'plan-author:batch-row-9',
      status: 'done',
      durationMs: 4400,
      label: 'Authored plan',
    }));
  });

  it('exports the frozen singleton handler set', () => {
    expect([...SINGLETON_HANDLERS]).toEqual([
      'spec-auto-draft',
      'explore-synthesize',
      'plan-author',
      'journal-harvest',
    ]);
  });
});
