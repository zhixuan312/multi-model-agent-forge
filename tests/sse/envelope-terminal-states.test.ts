// @vitest-environment node
import { interpretTerminal, terminalEvent } from '@/sse/envelope';

/**
 * Engine 5.16 added `cancelled` and `interrupted` terminal states, and BOTH carry a
 * non-null `error` — so the old "failure == error is non-null" rule collapsed a
 * deliberate cancellation into a failure, which made Forge's automation auto-retry it.
 * These tests pin the four-way mapping.
 */

/** The engine's `buildErrorEnvelope` shape (result-shape.ts), trimmed to what we read. */
function envelope(status: string, error: Record<string, unknown> | null, contextBlockId: string | null = null) {
  return {
    task: { taskId: 't-1', type: 'audit', status },
    output: { summary: null, filesChanged: [], contextBlockId },
    execution: { sessions: { implementer: null, reviewer: null }, worktree: null },
    metrics: {},
    raw: { implementer: null, reviewer: null },
    error,
  };
}

describe('interpretTerminal — terminal-state mapping', () => {
  it('completed → done, no error', () => {
    const s = interpretTerminal(envelope('completed', { kind: 'not_applicable' }));
    expect(s.status).toBe('done');
    expect(s.error).toBeNull();
  });

  it('done_with_concerns is a SUCCESS — concerns are advisory, not a failure', () => {
    const s = interpretTerminal(envelope('done_with_concerns', { kind: 'not_applicable' }));
    expect(s.status).toBe('done');
    expect(s.error).toBeNull();
  });

  it('failed → failed, error preserved', () => {
    const s = interpretTerminal(envelope('failed', { code: 'reviewer_parse_failed', message: 'boom' }));
    expect(s.status).toBe('failed');
    expect(s.error).toEqual({ code: 'reviewer_parse_failed', message: 'boom' });
  });

  it('cancelled → cancelled (NOT failed) even though it carries error.code=aborted', () => {
    const s = interpretTerminal(envelope('cancelled', { code: 'aborted', message: 'Execution cancelled by caller' }));
    expect(s.status).toBe('cancelled');
    // The error rides along for the UI message — it just isn't a failure verdict.
    expect(s.error).toEqual({ code: 'aborted', message: 'Execution cancelled by caller' });
  });

  it('cancelled-before-start is still cancelled', () => {
    const s = interpretTerminal(
      envelope('cancelled', { code: 'aborted', message: 'Execution cancelled by caller before it started' }),
    );
    expect(s.status).toBe('cancelled');
  });

  it('interrupted → failed (retryable ⇒ resubmit) with the daemon_restarted code intact', () => {
    const s = interpretTerminal(
      envelope('interrupted', {
        code: 'daemon_restarted',
        message: 'The MMA daemon restarted before this task completed. Submit the task again.',
        retryable: true,
      }),
    );
    expect(s.status).toBe('failed');
    // The distinct code/message must survive to the UI — not be flattened to a generic failure.
    expect(s.error).toEqual({
      code: 'daemon_restarted',
      message: 'The MMA daemon restarted before this task completed. Submit the task again.',
    });
  });

  it('still synthesizes pipeline_failed for a failed status with no error object', () => {
    const s = interpretTerminal(envelope('failed', null));
    expect(s.status).toBe('failed');
    expect(s.error).toEqual({ code: 'pipeline_failed', message: 'Pipeline completed with failed status' });
  });

  it('extracts the single top-level output.contextBlockId', () => {
    expect(interpretTerminal(envelope('completed', null, 'cb-9')).contextBlockId).toBe('cb-9');
    expect(interpretTerminal(envelope('completed', null)).contextBlockId).toBeNull();
  });

  it('a cancelled envelope with no error object still reads as cancelled', () => {
    const s = interpretTerminal(envelope('cancelled', null));
    expect(s.status).toBe('cancelled');
    expect(s.error).toEqual({ code: 'aborted', message: 'Execution cancelled by caller' });
  });
});

describe('terminalEvent', () => {
  const base = { taskId: 'task-1', mmaBatchId: 'row-1', route: 'audit' };

  it('cancelled → task.cancelled (its own event, not task.failed)', () => {
    const e = terminalEvent({
      ...base,
      state: { status: 'cancelled', error: { code: 'aborted', message: 'stopped' }, contextBlockId: null },
    });
    expect(e).toEqual({ ...base, type: 'task.cancelled', error: { code: 'aborted', message: 'stopped' } });
  });

  it('failed → task.failed', () => {
    const e = terminalEvent({
      ...base,
      state: { status: 'failed', error: { code: 'daemon_restarted', message: 'restarted' }, contextBlockId: null },
    });
    expect(e).toMatchObject({ type: 'task.failed', error: { code: 'daemon_restarted' } });
  });

  it('done → task.done', () => {
    const e = terminalEvent({ ...base, state: { status: 'done', error: null, contextBlockId: null } });
    expect(e).toMatchObject({ type: 'task.done', status: 'recorded' });
  });
});
