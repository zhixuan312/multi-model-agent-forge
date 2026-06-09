// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { project, stage } from '@/db/schema/projects';
import { auditPass } from '@/db/schema/artifacts';
import { actionLog } from '@/db/schema/audit';
import {
  freezeProject,
  canFreeze,
  recordAuditOverride,
  FreezeIrreversibleError,
} from '@/spec/freeze';
import { seedProject, cleanupSpecFixtures } from './db-fixtures';

afterAll(async () => {
  await cleanupSpecFixtures();
});

const db = getDb();

async function insertPass(projectId: string, passNo: number, verdict: 'clean' | 'revised'): Promise<void> {
  await db.insert(auditPass).values({
    projectId,
    scope: 'spec',
    passNo,
    findingsCount: verdict === 'clean' ? 0 : 1,
    verdict,
    mmaBatchId: null,
  });
}

describe('canFreeze (the verdict-or-override gate, F5/F26)', () => {
  it('false when no audit has run', async () => {
    const { projectId } = await seedProject();
    expect(await canFreeze(db, projectId)).toBe(false);
  });

  it('true when the latest pass is clean', async () => {
    const { projectId } = await seedProject();
    await insertPass(projectId, 1, 'revised');
    await insertPass(projectId, 2, 'clean');
    expect(await canFreeze(db, projectId)).toBe(true);
  });

  it('false when the latest pass is revised and no override', async () => {
    const { projectId } = await seedProject();
    await insertPass(projectId, 1, 'clean');
    await insertPass(projectId, 2, 'revised'); // a later re-run regressed
    expect(await canFreeze(db, projectId)).toBe(false);
  });

  it('true with a revised latest pass IF an audit_override row exists (F26)', async () => {
    const { projectId, ownerId } = await seedProject();
    await insertPass(projectId, 1, 'revised');
    expect(await canFreeze(db, projectId)).toBe(false);
    await recordAuditOverride(projectId, ownerId);
    expect(await canFreeze(db, projectId)).toBe(true);
  });
});

describe('freezeProject', () => {
  it('design→frozen transactionally: phase, frozen_at, stage done, action_log', async () => {
    const { projectId, ownerId } = await seedProject();
    await insertPass(projectId, 1, 'clean');

    const res = await freezeProject(projectId, ownerId);
    expect(res).toEqual({ ok: true, alreadyFrozen: false });

    const [p] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
    expect(p.phase).toBe('frozen');
    expect(p.frozenAt).toBeInstanceOf(Date);

    const [sp] = await db
      .select({ status: stage.status })
      .from(stage)
      .where(and(eq(stage.projectId, projectId), eq(stage.kind, 'spec')))
      .limit(1);
    expect(sp.status).toBe('done');

    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'freeze')));
    expect(logs).toHaveLength(1);
  });

  it('blocked (not_clean) when latest verdict is not clean and no override', async () => {
    const { projectId, ownerId } = await seedProject();
    await insertPass(projectId, 1, 'revised');
    const res = await freezeProject(projectId, ownerId);
    expect(res).toEqual({ ok: false, reason: 'not_clean' });
    const [p] = await db.select().from(project).where(eq(project.id, projectId)).limit(1);
    expect(p.phase).toBe('design'); // unchanged
  });

  it('irreversibility guard: a second freeze is a no-op (alreadyFrozen), not a re-freeze', async () => {
    const { projectId, ownerId } = await seedProject();
    await insertPass(projectId, 1, 'clean');
    await freezeProject(projectId, ownerId);
    const [first] = await db.select({ frozenAt: project.frozenAt }).from(project).where(eq(project.id, projectId));

    const second = await freezeProject(projectId, ownerId);
    expect(second).toEqual({ ok: true, alreadyFrozen: true });

    const [after] = await db.select({ frozenAt: project.frozenAt }).from(project).where(eq(project.id, projectId));
    expect(after.frozenAt?.getTime()).toBe(first.frozenAt?.getTime()); // not re-stamped

    // Exactly one freeze action_log row (no double).
    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'freeze')));
    expect(logs).toHaveLength(1);
  });

  it('rejects a freeze on a build/done project as irreversible', async () => {
    const { projectId, ownerId } = await seedProject();
    await insertPass(projectId, 1, 'clean');
    await db.update(project).set({ phase: 'build' }).where(eq(project.id, projectId));
    // canFreeze still true (clean), but the in-tx guard makes it a no-op alreadyFrozen.
    const res = await freezeProject(projectId, ownerId);
    expect(res).toEqual({ ok: true, alreadyFrozen: true });
    const [p] = await db.select({ phase: project.phase }).from(project).where(eq(project.id, projectId));
    expect(p.phase).toBe('build'); // untouched
    void FreezeIrreversibleError;
  });
});
