// @vitest-environment node
import {
  createLoop,
  updateLoop,
  listLoops,
  getLoop,
  deleteLoop,
  setLoopEnabled,
  rotateLoopEventToken,
} from '@/loops/loops-core';
import { createMockDb, seq } from '../test-utils/mock-db';

const RID = '11111111-1111-4111-8111-111111111111';
const VALID = {
  name: 'Hygiene',
  kind: 'maintenance',
  config: { goalMd: 'no dormant code' },
  mode: 'recurring',
  cron: '0 3 * * *',
  repoIds: [RID],
};
const loopRow = (o: Record<string, unknown> = {}) => ({
  id: 'loop-1',
  teamId: 'team-1',
  name: 'Hygiene',
  kind: 'maintenance',
  config: { goalMd: 'g' },
  workerTier: 'complex',
  mode: 'manual',
  cron: null,
  targetBranch: null,
  repoIds: [RID],
  eventTokenHash: null,
  enabled: true,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...o,
});

describe('createLoop', () => {
  it('creates a recurring loop when cron is valid', async () => {
    const db = createMockDb({ 'select:loop_def': [], 'insert:loop_def': [loopRow({ mode: 'recurring', cron: '0 3 * * *' })] });
    const res = await createLoop(VALID, { db, actorId: 'admin-1', teamId: 'team-1' });
    expect(res.kind).toBe('created');
    if (res.kind === 'created') expect(res.eventToken).toBeNull();
  });

  it('creates an event loop with a generated token and only stores the hash', async () => {
    const db = createMockDb({ 'select:loop_def': [], 'insert:loop_def': [loopRow({ mode: 'event', eventTokenHash: 'hash-1' })] });
    const res = await createLoop({ ...VALID, mode: 'event', cron: null }, { db, actorId: 'admin-1', teamId: 'team-1' });
    expect(res.kind).toBe('created');
    if (res.kind !== 'created') throw new Error('expected created');
    expect(res.eventToken).toBeTruthy();
    const values = db._callsFor('loop_def').find((c) => c.method === 'values');
    const inserted = (values?.args[0] ?? {}) as { eventTokenHash?: string };
    expect(inserted.eventTokenHash).toBeTruthy();
    expect(inserted.eventTokenHash).not.toBe(res.eventToken);
  });

  it('rejects invalid mode/cron combinations without writing', async () => {
    const db = createMockDb({ 'select:loop_def': [] });
    expect((await createLoop({ ...VALID, mode: 'event', cron: '0 3 * * *' }, { db, teamId: 'team-1' })).kind).toBe('invalid_mode');
    expect((await createLoop({ ...VALID, mode: 'recurring', cron: null }, { db, teamId: 'team-1' })).kind).toBe('invalid_mode');
    expect(db._assertCalled('loop_def', 'insert')).toBe(false);
  });
});

describe('updateLoop', () => {
  it('transitions a manual loop into event mode by nulling cron and generating a fresh token', async () => {
    const db = createMockDb({
      'select:loop_def': [loopRow({ mode: 'manual', cron: null, eventTokenHash: null })],
      'update:loop_def': [loopRow({ mode: 'event', cron: null, eventTokenHash: 'hash-2' })],
    });
    const res = await updateLoop('loop-1', { mode: 'event', cron: null }, { db, teamId: 'team-1' });
    expect(res.kind).toBe('updated');
    if (res.kind === 'updated') expect(res.eventToken).toBeTruthy();
  });

  it('keeps the existing token on unrelated event-mode updates', async () => {
    const db = createMockDb({
      'select:loop_def': seq([loopRow({ mode: 'event', eventTokenHash: 'hash-existing' })], []),
      'update:loop_def': [loopRow({ mode: 'event', eventTokenHash: 'hash-existing', name: 'Retitled' })],
    });
    const res = await updateLoop('loop-1', { name: 'Retitled' }, { db, teamId: 'team-1' });
    expect(res.kind).toBe('updated');
    if (res.kind === 'updated') expect(res.eventToken).toBeNull();
  });

  it('rejects bad mode transitions before writing', async () => {
    const db = createMockDb({ 'select:loop_def': [loopRow({ mode: 'manual', cron: null })] });
    expect((await updateLoop('loop-1', { mode: 'event', cron: '0 4 * * *' }, { db, teamId: 'team-1' })).kind).toBe('invalid_mode');
    expect(db._assertCalled('loop_def', 'update')).toBe(false);
  });
});

describe('rotateLoopEventToken', () => {
  it('rotates only event-mode loops and returns the plaintext once', async () => {
    const db = createMockDb({
      'select:loop_def': [loopRow({ mode: 'event', eventTokenHash: 'hash-old' })],
      'update:loop_def': [loopRow({ mode: 'event', eventTokenHash: 'hash-new' })],
    });
    const res = await rotateLoopEventToken('loop-1', { db, teamId: 'team-1' });
    expect(res.kind).toBe('rotated');
    if (res.kind === 'rotated') expect(res.eventToken).toBeTruthy();
  });

  it('rejects non-event loops for rotation', async () => {
    const db = createMockDb({ 'select:loop_def': [loopRow({ mode: 'manual' })] });
    expect((await rotateLoopEventToken('loop-1', { db, teamId: 'team-1' })).kind).toBe('wrong_mode');
  });
});

describe('reads + toggles', () => {
  it('listLoops returns rows; getLoop returns a row or null', async () => {
    expect(await listLoops({ db: createMockDb({ 'select:loop_def': [loopRow(), loopRow({ id: 'l2' })] }), teamId: 'team-1' })).toHaveLength(2);
    expect(await getLoop('loop-1', { db: createMockDb({ 'select:loop_def': [loopRow()] }), teamId: 'team-1' })).not.toBeNull();
    expect(await getLoop('x', { db: createMockDb({ 'select:loop_def': [] }), teamId: 'team-1' })).toBeNull();
  });

  it('deleteLoop / setLoopEnabled report deleted|updated vs not_found', async () => {
    expect((await deleteLoop('loop-1', { db: createMockDb({ 'delete:loop_def': [{ id: 'loop-1' }] }), teamId: 'team-1' })).kind).toBe('deleted');
    expect((await deleteLoop('x', { db: createMockDb({ 'delete:loop_def': [] }), teamId: 'team-1' })).kind).toBe('not_found');
    expect((await setLoopEnabled('loop-1', false, { db: createMockDb({ 'update:loop_def': [{ id: 'loop-1' }] }), teamId: 'team-1' })).kind).toBe('updated');
    expect((await setLoopEnabled('x', false, { db: createMockDb({ 'update:loop_def': [] }), teamId: 'team-1' })).kind).toBe('not_found');
  });

  it('rejects duplicate names case-insensitively on rename', async () => {
    const db = createMockDb({ 'select:loop_def': seq([loopRow()], [{ id: 'other' }]) });
    expect((await updateLoop('loop-1', { name: 'Taken' }, { db, teamId: 'team-1' })).kind).toBe('duplicate_name');
  });
});
