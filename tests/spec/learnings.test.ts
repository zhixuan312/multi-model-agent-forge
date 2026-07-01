// @vitest-environment node
import { vi } from 'vitest';
import {
  buildLearningsPrompt,
  commitLearnings,
  setLearningStatus,
  addLearning,
  loadLearnings,
  parseRecordedNodeIds,
  JournalRecordIncompleteError,
} from '@/spec/learnings';
import { journalEnvelope, type RecordedDispatch } from './mock-mma';
import { createMockDb, seq } from '../test-utils/mock-db';

const WS_ROOT = '/forge-workspace-test-root';

let dispatchMmaEnvelope: unknown = {};
const dispatchMmaCalls: Array<{ route: string; cwd: string; body: unknown }> = [];
vi.mock('@/dispatch/dispatch-helpers', () => ({
  dispatchMma: async (opts: Record<string, unknown>) => {
    dispatchMmaCalls.push({ route: opts.route as string, cwd: opts.cwd as string, body: opts.body });
    return { batchRowId: 'batch-1', envelope: dispatchMmaEnvelope };
  },
}));

describe('parseRecordedNodeIds (pure)', () => {
  it('reads output.summary.recorded[].ids[]', () => {
    expect(parseRecordedNodeIds(journalEnvelope(['0007-some-slug', '0008-next']))).toEqual([
      '0007-some-slug',
      '0008-next',
    ]);
  });

  it('returns [] when recorded is absent', () => {
    expect(parseRecordedNodeIds({ output: { summary: { other: 'x' } } })).toEqual([]);
    expect(parseRecordedNodeIds({})).toEqual([]);
  });
});

describe('buildLearningsPrompt', () => {
  it('includes project name, intent, and spec in the prompt', async () => {
    const projectId = 'proj-1';
    const mockDb = createMockDb({
      'select:project': [{ intentMd: 'Remove DB from demo', name: 'db' }],
      'select:project_qa_message': [],
    });

    const { system, user } = await buildLearningsPrompt(mockDb, projectId);
    expect(system).toContain('learnings curator');
    expect(user).toContain('db');
    expect(user).toContain('Remove DB from demo');
  });
});

describe('curation', () => {
  it('keep/remove flips status; add inserts a kept member candidate', async () => {
    const projectId = 'proj-3';
    const ownerId = 'owner-3';
    const mockDb = createMockDb({
      'select:project_learning_candidate': [
        { id: 'cand-1', projectId, status: 'kept', origin: 'spec', bodyMd: 'A.', type: 'insight' },
        { id: 'cand-2', projectId, status: 'kept', origin: 'member', bodyMd: 'My own learning.', type: 'decision' },
      ],
      'insert:project_learning_candidate': [
        { id: 'cand-2', projectId, status: 'kept', origin: 'member', bodyMd: 'My own learning.', type: 'decision' },
      ],
      'update:project_learning_candidate': [{ id: 'cand-1', projectId, status: 'kept' }],
    });

    await setLearningStatus(projectId, 'cand-1', 'kept', { db: mockDb });
    await addLearning(projectId, { bodyMd: 'My own learning.', type: 'decision' }, ownerId, { db: mockDb });
    const all = await loadLearnings(mockDb, projectId);
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.id === 'cand-1')?.status).toBe('kept');
  });
});

describe('commitLearnings (cwd MUST be workspace root)', () => {
  beforeEach(() => { dispatchMmaCalls.length = 0; });

  it('dispatches journal-record at cwd=workspace root, stamps node ids, flips to recorded', async () => {
    const projectId = 'proj-4';
    const ownerId = 'owner-4';
    dispatchMmaEnvelope = journalEnvelope(['0007-some-slug', '0008-next-slug']);
    const mockDb = createMockDb({
      'select:project_learning_candidate': seq(
        [
          { id: 'cand-1', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept one with enough length to satisfy.', type: 'insight' },
          { id: 'cand-2', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept two with enough length to satisfy.', type: 'decision' },
        ],
        [
          { id: 'cand-1', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept one with enough length to satisfy.', type: 'insight', recordedNodeId: '0007-some-slug' },
          { id: 'cand-2', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept two with enough length to satisfy.', type: 'decision', recordedNodeId: '0008-next-slug' },
        ],
      ),
      'update:project_learning_candidate': [
        { id: 'cand-1', projectId, status: 'recorded', recordedNodeId: '0007-some-slug' },
        { id: 'cand-2', projectId, status: 'recorded', recordedNodeId: '0008-next-slug' },
      ],
      'insert:ops_action_log': [{ id: 'log-1', projectId, action: 'record_learnings' }],
    });

    const mma = {} as any;
    const res = await commitLearnings({ db: mockDb, mma, workspaceRoot: WS_ROOT }, projectId, ownerId);
    expect(res.recordedCount).toBe(2);
    expect(dispatchMmaCalls[0].route).toBe('journal_record');
    expect(dispatchMmaCalls[0].cwd).toBe(WS_ROOT);
    expect((dispatchMmaCalls[0].body as { learnings: string[] }).learnings).toHaveLength(2);
  });

  it('missing node ids → JournalRecordIncompleteError, candidates stay kept (F4)', async () => {
    const projectId = 'proj-6';
    const ownerId = 'owner-6';
    dispatchMmaEnvelope = journalEnvelope([]);
    const mockDb = createMockDb({
      'select:project_learning_candidate': [
        { id: 'cand-1', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept but the write fails.', type: 'insight' },
      ],
    });
    const mma = {} as any;
    await expect(
      commitLearnings({ db: mockDb, mma, workspaceRoot: WS_ROOT }, projectId, ownerId),
    ).rejects.toBeInstanceOf(JournalRecordIncompleteError);
  });
});
