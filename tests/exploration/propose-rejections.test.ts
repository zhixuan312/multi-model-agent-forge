// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/details/write', () => ({ updateDetails: vi.fn(async () => {}) }));

import { setLogSink, type LogRecord } from '@/observability/log-event';
import { getHandler, ensureHandlersRegistered } from '@/dispatch/handler-registry';
import { createMockDb } from '../test-utils/mock-db';

/**
 * A non-conformant proposal is rightly dropped — silently is the problem. With no record,
 * "the model proposed nothing" and "everything it proposed was rejected" look identical:
 * an empty Discover list either way, and no way to tell which.
 */
const envelope = (tasks: unknown[]) => ({ output: { summary: JSON.stringify({ tasks }) } });

async function run(tasks: unknown[]): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  const restore = setLogSink((r) => { records.push(r); });
  try {
    await ensureHandlersRegistered();
    await getHandler('explore-propose')!(
      createMockDb(),
      { batchRowId: 'b1', projectId: 'p1', handler: 'explore-propose', request: { actorId: 'm1', repoIds: ['r1'] }, actorId: 'm1' },
      envelope(tasks),
    );
  } finally {
    restore();
  }
  return records;
}

describe('rejected exploration proposals are recorded', () => {
  const good = { kind: 'investigate', targetRepoId: 'r1', prompt: 'x'.repeat(400) };

  it('warns when every proposal is rejected', async () => {
    const records = await run([{ kind: 'investigate', targetRepoId: 'not-linked', prompt: 'x'.repeat(400) }]);
    const rejection = records.find((r) => r.event === 'explore.proposals_rejected');
    expect(rejection, 'nothing recorded the rejection').toBeDefined();
    expect(rejection).toMatchObject({ level: 'warn', projectId: 'p1', count: 1 });
    expect(rejection!.detail).toMatch(/linked repo/);
  });

  it('notes a partial rejection without raising it to a warning', async () => {
    const records = await run([good, { kind: 'research', prompt: 'too short' }]);
    const rejection = records.find((r) => r.event === 'explore.proposals_rejected');
    expect(rejection).toMatchObject({ level: 'info', count: 1 });
    expect(rejection!.detail).toMatch(/1 kept of 2/);
  });

  it('says nothing when every proposal conforms', async () => {
    const records = await run([good]);
    expect(records.find((r) => r.event === 'explore.proposals_rejected')).toBeUndefined();
  });
});
