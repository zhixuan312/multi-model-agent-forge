// @vitest-environment node
import {
  createLoop,
  updateLoop,
  listLoops,
  getLoop,
  deleteLoop,
  setLoopEnabled,
} from '@/loops/loops-core';
import { createMockDb, seq } from '../test-utils/mock-db';

// Backend tests run on a mocked Drizzle Db (gumi convention) — no database.
const RID = '11111111-1111-4111-8111-111111111111';
const VALID = { name: 'Hygiene', kind: 'maintenance', config: { goalMd: 'no dormant code' }, cron: '0 3 * * *', repoIds: [RID] };
const loopRow = (o: Record<string, unknown> = {}) => ({
  id: 'loop-1', name: 'Hygiene', kind: 'maintenance', config: { goalMd: 'g' },
  workerTier: 'complex', cron: '0 3 * * *', repoIds: [RID], enabled: true,
  createdBy: null, createdAt: new Date(), updatedAt: new Date(), ...o,
});

describe('createLoop', () => {
  it('creates a valid loop (config + cron + name unique)', async () => {
    const db = createMockDb({ 'select:loop_def': [], 'insert:loop_def': [loopRow()] });
    const res = await createLoop(VALID, { db, actorId: 'admin-1', teamId: 'team-1' });
    expect(res.kind).toBe('created');
    expect(db._assertCalled('loop_def', 'insert')).toBe(true);
  });

  it('rejects invalid shape (empty name / no repos) without writing', async () => {
    const db = createMockDb();
    expect((await createLoop({ ...VALID, name: '' }, { db, teamId: 'team-1' })).kind).toBe('invalid');
    expect((await createLoop({ ...VALID, repoIds: [] }, { db, teamId: 'team-1' })).kind).toBe('invalid');
    expect(db._assertCalled('loop_def', 'insert')).toBe(false);
  });

  it('rejects an invalid per-kind config', async () => {
    const db = createMockDb({ 'select:loop_def': [] });
    expect((await createLoop({ ...VALID, config: { goalMd: '' } }, { db, teamId: 'team-1' })).kind).toBe('invalid_config');
  });

  it('rejects an invalid cron', async () => {
    const db = createMockDb({ 'select:loop_def': [] });
    expect((await createLoop({ ...VALID, cron: 'not a cron' }, { db, teamId: 'team-1' })).kind).toBe('invalid_cron');
  });

  it('creates a one-time job (no cron) and a targeted loop (targetBranch)', async () => {
    const db = createMockDb({ 'select:loop_def': [], 'insert:loop_def': [loopRow({ cron: null })] });
    expect((await createLoop({ ...VALID, cron: null }, { db, teamId: 'team-1' })).kind).toBe('created'); // one-time
    const db2 = createMockDb({ 'select:loop_def': [], 'insert:loop_def': [loopRow({ targetBranch: 'develop' })] });
    expect((await createLoop({ ...VALID, targetBranch: 'develop' }, { db: db2, teamId: 'team-1' })).kind).toBe('created');
  });

  it('rejects a duplicate name (case-insensitive)', async () => {
    const db = createMockDb({ 'select:loop_def': [{ id: 'other' }] });
    expect((await createLoop(VALID, { db, teamId: 'team-1' })).kind).toBe('duplicate_name');
    expect(db._assertCalled('loop_def', 'insert')).toBe(false);
  });
});

describe('updateLoop', () => {
  it('not_found when the loop is missing', async () => {
    const db = createMockDb({ 'select:loop_def': [] });
    expect((await updateLoop('x', { cron: '0 4 * * *' }, { db, teamId: 'team-1' })).kind).toBe('not_found');
  });

  it('updates an existing loop', async () => {
    const db = createMockDb({ 'select:loop_def': [loopRow()], 'update:loop_def': [loopRow({ cron: '0 4 * * *' })] });
    const res = await updateLoop('loop-1', { cron: '0 4 * * *' }, { db, teamId: 'team-1' });
    expect(res.kind).toBe('updated');
    expect(db._assertCalled('loop_def', 'update')).toBe(true);
  });

  it('rejects an invalid cron on update', async () => {
    const db = createMockDb({ 'select:loop_def': [loopRow()] });
    expect((await updateLoop('loop-1', { cron: 'bad' }, { db, teamId: 'team-1' })).kind).toBe('invalid_cron');
    expect(db._assertCalled('loop_def', 'update')).toBe(false);
  });

  it('rejects a duplicate name on rename (excluding self)', async () => {
    const db = createMockDb({ 'select:loop_def': seq([loopRow()], [{ id: 'other' }]) });
    expect((await updateLoop('loop-1', { name: 'Taken' }, { db, teamId: 'team-1' })).kind).toBe('duplicate_name');
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

  it('lists only loops for the actor team', async () => {
    const db = createMockDb({
      'select:loop_def': [{
        id: 'loop-1',
        teamId: 'team-a',
        name: 'Hygiene',
        kind: 'maintenance',
        config: {},
        workerTier: 'complex',
        cron: null,
        repoIds: [],
        enabled: true,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
    });
    await listLoops({
      db,
      teamId: 'team-b',
    });
    expect(db._assertCalled('loop_def', 'where')).toBe(true);
  });
});
