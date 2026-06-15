// @vitest-environment node
import { and, eq } from 'drizzle-orm';
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
import { mockAnthropicClient } from './mock-anthropic';
import { mockMma, journalEnvelope, type RecordedDispatch } from './mock-mma';
import { createMockDb, seq } from '../test-utils/mock-db';

const WS_ROOT = '/forge-workspace-test-root';

describe('parseRecordedNodeIds (pure)', () => {
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

describe('proposeLearnings (mock Anthropic)', () => {
  it('inserts proposed/origin=spec candidates from composeLearningCandidates', async () => {
    const projectId = 'proj-1';
    const mockDb = createMockDb({
      'select:artifact': [{ id: 'art-1', projectId, kind: 'spec', bodyMd: '# Frozen spec', version: 1 }],
      'select:learning_candidate': [],
      'insert:learning_candidate': [
        { id: 'cand-1', projectId, status: 'proposed', origin: 'spec', bodyMd: 'The dual gate was the riskiest part.', type: 'challenge' },
        { id: 'cand-2', projectId, status: 'proposed', origin: 'spec', bodyMd: 'We chose workspace-root cwd for audits.', type: 'decision' },
      ],
    });
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
    const proposed = await proposeLearnings({ db: mockDb, anthropic }, projectId);
    expect(proposed).toHaveLength(2);
    expect(proposed.every((c) => c.status === 'proposed')).toBe(true);
  });

  it('is idempotent — a re-load does not duplicate candidates', async () => {
    const projectId = 'proj-2';
    const mockDb = createMockDb({
      'select:artifact': [{ id: 'art-1', projectId, kind: 'spec', bodyMd: '# Frozen spec', version: 1 }],
      'select:learning_candidate': seq([], [{ id: 'cand-1', projectId, status: 'proposed', origin: 'spec', bodyMd: 'One.', type: 'insight' }]),
      'insert:learning_candidate': [{ id: 'cand-1', projectId, status: 'proposed', origin: 'spec', bodyMd: 'One.', type: 'insight' }],
    });
    const anthropic = mockAnthropicClient({
      composeLearningCandidates: [{ candidates: [{ bodyMd: 'One.', type: 'insight' }] }],
    });
    await proposeLearnings({ db: mockDb, anthropic }, projectId);
    const second = await proposeLearnings({ db: mockDb, anthropic }, projectId);
    expect(second).toHaveLength(1);
  });
});

describe('curation', () => {
  it('keep/remove flips status; add inserts a kept member candidate', async () => {
    const projectId = 'proj-3';
    const ownerId = 'owner-3';
    const mockDb = createMockDb({
      'select:artifact': [{ id: 'art-1', projectId, kind: 'spec', bodyMd: '# Frozen spec', version: 1 }],
      'select:learning_candidate': seq(
        [],
        [
          { id: 'cand-1', projectId, status: 'kept', origin: 'spec', bodyMd: 'A.', type: 'insight' },
          { id: 'cand-2', projectId, status: 'kept', origin: 'member', bodyMd: 'My own learning.', type: 'decision' },
        ],
      ),
      'insert:learning_candidate': [
        { id: 'cand-1', projectId, status: 'proposed', origin: 'spec', bodyMd: 'A.', type: 'insight' },
        { id: 'cand-2', projectId, status: 'kept', origin: 'member', bodyMd: 'My own learning.', type: 'decision' },
      ],
      'update:learning_candidate': [{ id: 'cand-1', projectId, status: 'kept' }],
    });
    const anthropic = mockAnthropicClient({
      composeLearningCandidates: [{ candidates: [{ bodyMd: 'A.', type: 'insight' }] }],
    });
    const [c] = await proposeLearnings({ db: mockDb, anthropic }, projectId);
    await setLearningStatus(projectId, c.id, 'kept', { db: mockDb });
    await addLearning(projectId, { bodyMd: 'My own learning.', type: 'decision' }, ownerId, { db: mockDb });
    const all = await loadLearnings(mockDb, projectId);
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.id === c.id)?.status).toBe('kept');
  });
});

describe('commitLearnings (mock MMA — cwd MUST be workspace root)', () => {
  it('dispatches journal-record at cwd=workspace root, stamps node ids, flips to recorded', async () => {
    const projectId = 'proj-4';
    const ownerId = 'owner-4';
    const calls: RecordedDispatch[] = [];
    const mockDb = createMockDb({
      'select:learning_candidate': seq(
        [
          { id: 'cand-1', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept one with enough length to satisfy.', type: 'insight' },
          { id: 'cand-2', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept two with enough length to satisfy.', type: 'decision' },
        ],
        [
          { id: 'cand-1', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept one with enough length to satisfy.', type: 'insight', recordedNodeId: '0007-some-slug' },
          { id: 'cand-2', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept two with enough length to satisfy.', type: 'decision', recordedNodeId: '0008-next-slug' },
        ],
      ),
      'insert:learning_candidate': [
        { id: 'cand-1', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept one with enough length to satisfy.', type: 'insight' },
        { id: 'cand-2', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept two with enough length to satisfy.', type: 'decision' },
      ],
      'update:learning_candidate': [
        { id: 'cand-1', projectId, status: 'recorded', recordedNodeId: '0007-some-slug' },
        { id: 'cand-2', projectId, status: 'recorded', recordedNodeId: '0008-next-slug' },
      ],
      'insert:action_log': [{ id: 'log-1', projectId, action: 'record_learnings' }],
    });

    const mma = mockMma({
      envelopes: { 'journal-record': [journalEnvelope(['0007-some-slug', '0008-next-slug'])] },
      calls,
    });

    const res = await commitLearnings({ db: mockDb, mma, workspaceRoot: WS_ROOT }, projectId, ownerId);
    expect(res.recordedCount).toBe(2);
    expect(calls[0].route).toBe('journal-record');
    expect(calls[0].cwd).toBe(WS_ROOT);
    expect((calls[0].body as { learnings: string[] }).learnings).toHaveLength(2);
  });

  it('only KEPT candidates are written (proposed/removed are excluded)', async () => {
    const projectId = 'proj-5';
    const ownerId = 'owner-5';
    const calls: RecordedDispatch[] = [];
    const mockDb = createMockDb({
      'select:artifact': [{ id: 'art-1', projectId, kind: 'spec', bodyMd: '# Frozen spec', version: 1 }],
      'select:learning_candidate': seq(
        [],
        [{ id: 'cand-3', projectId, status: 'kept', origin: 'member', bodyMd: 'The only kept.', type: 'decision' }],
      ),
      'insert:learning_candidate': [
        { id: 'cand-1', projectId, status: 'proposed', origin: 'spec', bodyMd: 'Proposed (left untouched).', type: 'insight' },
        { id: 'cand-2', projectId, status: 'proposed', origin: 'spec', bodyMd: 'Removed one.', type: 'challenge' },
        { id: 'cand-3', projectId, status: 'kept', origin: 'member', bodyMd: 'The only kept.', type: 'decision' },
      ],
      'update:learning_candidate': [{ id: 'cand-2', status: 'removed' }, { id: 'cand-3', status: 'recorded', recordedNodeId: '0009-only' }],
      'insert:action_log': [{ id: 'log-1', projectId, action: 'record_learnings' }],
    });

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
    const proposed = await proposeLearnings({ db: mockDb, anthropic }, projectId);
    await setLearningStatus(projectId, proposed[1].id, 'removed', { db: mockDb });
    await addLearning(projectId, { bodyMd: 'The only kept.', type: 'decision' }, ownerId, { db: mockDb });

    const mma = mockMma({ envelopes: { 'journal-record': [journalEnvelope(['0009-only'])] }, calls });
    const res = await commitLearnings({ db: mockDb, mma, workspaceRoot: WS_ROOT }, projectId, ownerId);
    expect(res.recordedCount).toBe(1);
    expect((calls[0].body as { learnings: string[] }).learnings).toEqual(['The only kept.']);
  });

  it('missing node ids → JournalRecordIncompleteError, candidates stay kept (F4)', async () => {
    const projectId = 'proj-6';
    const ownerId = 'owner-6';
    const mockDb = createMockDb({
      'select:learning_candidate': [
        { id: 'cand-1', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept but the write fails.', type: 'insight' },
      ],
      'insert:learning_candidate': [
        { id: 'cand-1', projectId, status: 'kept', origin: 'member', bodyMd: 'Kept but the write fails.', type: 'insight' },
      ],
    });
    const mma = mockMma({ envelopes: { 'journal-record': [journalEnvelope([])] } });
    await expect(
      commitLearnings({ db: mockDb, mma, workspaceRoot: WS_ROOT }, projectId, ownerId),
    ).rejects.toBeInstanceOf(JournalRecordIncompleteError);
  });
});
