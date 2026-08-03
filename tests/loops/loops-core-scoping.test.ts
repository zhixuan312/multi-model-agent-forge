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

/**
 * The kind registry's Zod schema is what a loop's `config` MEANS — it trims the goal and
 * drops keys the kind does not define. Both writers validated with it and then persisted
 * the RAW input, so the validated value was computed and thrown away: an untrimmed goal
 * was stored untrimmed, and arbitrary extra keys were stored alongside it.
 */
describe('a loop stores the config its schema produced', () => {
  const written = (db: ReturnType<typeof createMockDb>, method: 'values' | 'set') => {
    const call = db._callsFor('loop_def').find((c) => c.method === method);
    return (call!.args[0] as { config: unknown }).config;
  };

  it('createLoop persists the parsed config, not the raw body', async () => {
    const { createLoop } = await import('@/loops/loops-core');
    const db = createMockDb({ 'select:loop_def': [], 'insert:loop_def': [{ id: 'l1' }] });
    await createLoop(
      { name: 'N', kind: 'maintenance', config: { goalMd: '  tidy up  ', sneaky: 'x' }, repoIds: ['11111111-1111-4111-8111-111111111111'] },
      { db, teamId: 'team-1' },
    );
    expect(written(db, 'values')).toEqual({ goalMd: 'tidy up' });
  });

  it('updateLoop persists the parsed config too', async () => {
    const { updateLoop } = await import('@/loops/loops-core');
    const db = createMockDb({
      'select:loop_def': [{ id: 'l1', teamId: 'team-1', kind: 'maintenance', mode: 'manual', cron: null, eventTokenHash: null, name: 'N' }],
      'update:loop_def': [{ id: 'l1' }],
    });
    await updateLoop('l1', { config: { goalMd: '  tidy up  ', sneaky: 'x' } }, { db, teamId: 'team-1' });
    expect(written(db, 'set')).toEqual({ goalMd: 'tidy up' });
  });
});
