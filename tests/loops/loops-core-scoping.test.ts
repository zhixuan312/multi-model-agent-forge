// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { updateLoop, deleteLoop, rotateLoopEventToken } from '@/loops/loops-core';
import { createMockDb } from '../test-utils/mock-db';

/**
 * Every loops mutation matched `deps.teamId ? scoped : ANY TEAM'S ROW`. Each has exactly
 * one caller and all of them pass a teamId from the auth gate, so the unscoped branch was
 * unreachable — but it is a cross-team write sitting one new caller away, and `createLoop`
 * already refuses without a teamId rather than offering the same fallback.
 *
 * `getLoop` deliberately keeps its unscoped read: the scheduler resolves loops across
 * every team and has no single teamId to pass.
 */
describe('loop mutations refuse to act without a team scope', () => {
  const row = [{ id: 'l1', teamId: 'team-1', mode: 'event', name: 'N', kind: 'maintenance' }];

  it('updateLoop reports not_found rather than matching any team\'s loop', async () => {
    const db = createMockDb({ 'select:loop_def': row, 'update:loop_def': row });
    const result = await updateLoop('l1', { name: 'Renamed' }, { db });
    expect(result.kind).toBe('not_found');
    expect(db._wasCalled('loop_def', 'update')).toBe(false);
  });

  it('deleteLoop reports not_found rather than deleting any team\'s loop', async () => {
    const db = createMockDb({ 'delete:loop_def': row });
    const result = await deleteLoop('l1', { db });
    expect(result.kind).toBe('not_found');
    expect(db._wasCalled('loop_def', 'delete')).toBe(false);
  });

  it('rotateLoopEventToken reports not_found rather than rotating any team\'s token', async () => {
    const db = createMockDb({ 'select:loop_def': row, 'update:loop_def': row });
    const result = await rotateLoopEventToken('l1', { db });
    expect(result.kind).toBe('not_found');
    expect(db._wasCalled('loop_def', 'update')).toBe(false);
  });
});
