// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { artifact, learningCandidate } from '@/db/schema/artifacts';
import { actionLog } from '@/db/schema/audit';
import {
  proposeLearnings,
  commitLearnings,
  setLearningStatus,
  addLearning,
  loadLearnings,
  parseRecordedNodeIds,
  JournalRecordIncompleteError,
} from '@/spec/learnings';
import { seedProject, cleanupSpecFixtures } from './db-fixtures';
import { mockAnthropicClient } from './mock-anthropic';
import { mockMma, journalEnvelope, type RecordedDispatch } from './mock-mma';

// Live-DB integration suite — gated OFF: no test DB exists; production must not be
// mutated, so these skip. See tests/setup.ts.
const hasDb = !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!hasDb) return;
  await cleanupSpecFixtures();
});

const db = hasDb ? getDb() : (undefined as never);
const WS_ROOT = '/forge-workspace-test-root';

async function seedProjectWithSpec(): Promise<{ projectId: string; ownerId: string }> {
  const { projectId, ownerId } = await seedProject();
  await db.insert(artifact).values({ projectId, kind: 'spec', bodyMd: '# Frozen spec', version: 1, createdBy: null });
  return { projectId, ownerId };
}

describe.skipIf(!hasDb)('parseRecordedNodeIds (pure)', () => {
  it('reads structuredReport.recorded[].ids[]', () => {
    expect(parseRecordedNodeIds(journalEnvelope(['0007-some-slug', '0008-next']))).toEqual([
      '0007-some-slug',
      '0008-next',
    ]);
  });

  it('returns [] when recorded is absent', () => {
    expect(parseRecordedNodeIds({ structuredReport: { summary: 'x' } })).toEqual([]);
    expect(parseRecordedNodeIds({})).toEqual([]);
  });
});

describe.skipIf(!hasDb)('proposeLearnings (mock Anthropic)', () => {
  it('inserts proposed/origin=spec candidates from composeLearningCandidates', async () => {
    const { projectId } = await seedProjectWithSpec();
    const anthropic = mockAnthropicClient({
      composeLearningCandidates: [
        {
          candidates: [
            { bodyMd: 'The dual gate was the riskiest part.', type: 'challenge' },
            { bodyMd: 'We chose workspace-root cwd for audits.', type: 'decision' },
          ],
        },
      ],
    });
    const proposed = await proposeLearnings({ db, anthropic }, projectId);
    expect(proposed).toHaveLength(2);
    expect(proposed.every((c) => c.status === 'proposed')).toBe(true);

    const rows = await db.select().from(learningCandidate).where(eq(learningCandidate.projectId, projectId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.origin === 'spec')).toBe(true);
  });

  it('is idempotent — a re-load does not duplicate candidates', async () => {
    const { projectId } = await seedProjectWithSpec();
    const anthropic = mockAnthropicClient({
      composeLearningCandidates: [{ candidates: [{ bodyMd: 'One.', type: 'insight' }] }],
    });
    await proposeLearnings({ db, anthropic }, projectId);
    // Second call: the mock has no second script, but idempotency means it is not called.
    const second = await proposeLearnings({ db, anthropic }, projectId);
    expect(second).toHaveLength(1);
    const rows = await db.select().from(learningCandidate).where(eq(learningCandidate.projectId, projectId));
    expect(rows).toHaveLength(1);
  });
});

describe.skipIf(!hasDb)('curation', () => {
  it('keep/remove flips status; add inserts a kept member candidate', async () => {
    const { projectId, ownerId } = await seedProjectWithSpec();
    const anthropic = mockAnthropicClient({
      composeLearningCandidates: [{ candidates: [{ bodyMd: 'A.', type: 'insight' }] }],
    });
    const [c] = await proposeLearnings({ db, anthropic }, projectId);
    await setLearningStatus(projectId, c.id, 'kept');
    await addLearning(projectId, { bodyMd: 'My own learning.', type: 'decision' }, ownerId);

    const all = await loadLearnings(db, projectId);
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.id === c.id)?.status).toBe('kept');
    const mine = all.find((x) => x.bodyMd === 'My own learning.');
    expect(mine?.status).toBe('kept');
  });
});

describe.skipIf(!hasDb)('commitLearnings (mock MMA — cwd MUST be workspace root)', () => {
  it('dispatches journal-record at cwd=workspace root, stamps node ids, flips to recorded', async () => {
    const { projectId, ownerId } = await seedProjectWithSpec();
    await addLearning(projectId, { bodyMd: 'Kept one with enough length to satisfy.', type: 'insight' }, ownerId);
    await addLearning(projectId, { bodyMd: 'Kept two with enough length to satisfy.', type: 'decision' }, ownerId);

    const calls: RecordedDispatch[] = [];
    const mma = mockMma({
      envelopes: { 'journal-record': [journalEnvelope(['0007-some-slug', '0008-next-slug'])] },
      calls,
    });

    const res = await commitLearnings({ db, mma, workspaceRoot: WS_ROOT }, projectId, ownerId);
    expect(res.recordedCount).toBe(2);

    // cwd MUST be the workspace root (NEVER a project repo); body carries learnings[].
    expect(calls[0].route).toBe('journal-record');
    expect(calls[0].cwd).toBe(WS_ROOT);
    expect((calls[0].body as { learnings: string[] }).learnings).toHaveLength(2);

    const rows = await db
      .select()
      .from(learningCandidate)
      .where(eq(learningCandidate.projectId, projectId));
    expect(rows.every((r) => r.status === 'recorded')).toBe(true);
    expect(rows.map((r) => r.recordedNodeId).sort()).toEqual(['0007-some-slug', '0008-next-slug'].sort());

    const logs = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.projectId, projectId), eq(actionLog.action, 'record_learnings')));
    expect(logs).toHaveLength(1);
  });

  it('only KEPT candidates are written (proposed/removed are excluded)', async () => {
    const { projectId, ownerId } = await seedProjectWithSpec();
    const anthropic = mockAnthropicClient({
      composeLearningCandidates: [
        {
          candidates: [
            { bodyMd: 'Proposed (left untouched).', type: 'insight' },
            { bodyMd: 'Removed one.', type: 'challenge' },
          ],
        },
      ],
    });
    const proposed = await proposeLearnings({ db, anthropic }, projectId);
    await setLearningStatus(projectId, proposed[1].id, 'removed');
    await addLearning(projectId, { bodyMd: 'The only kept.', type: 'decision' }, ownerId);

    const calls: RecordedDispatch[] = [];
    const mma = mockMma({ envelopes: { 'journal-record': [journalEnvelope(['0009-only'])] }, calls });
    const res = await commitLearnings({ db, mma, workspaceRoot: WS_ROOT }, projectId, ownerId);
    expect(res.recordedCount).toBe(1);
    expect((calls[0].body as { learnings: string[] }).learnings).toEqual(['The only kept.']);
  });

  it('missing node ids → JournalRecordIncompleteError, candidates stay kept (F4)', async () => {
    const { projectId, ownerId } = await seedProjectWithSpec();
    await addLearning(projectId, { bodyMd: 'Kept but the write fails.', type: 'insight' }, ownerId);
    const mma = mockMma({ envelopes: { 'journal-record': [journalEnvelope([])] } });
    await expect(
      commitLearnings({ db, mma, workspaceRoot: WS_ROOT }, projectId, ownerId),
    ).rejects.toBeInstanceOf(JournalRecordIncompleteError);

    const rows = await db.select().from(learningCandidate).where(eq(learningCandidate.projectId, projectId));
    expect(rows[0].status).toBe('kept');
    expect(rows[0].recordedNodeId).toBeNull();
  });
});
