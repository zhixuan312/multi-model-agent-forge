import { applyJournalRecordResult } from '@/journal/project-journal-recording';

describe('applyJournalRecordResult', () => {
  it('marks successful rows recorded, keeps failures, and fans out chunk-level errors', () => {
    const rows = [
      { id: 'r1', body: 'A', status: 'kept', topic: 'core', seq: 0 },
      { id: 'r2', body: 'B', status: 'kept', topic: 'core', seq: 1 },
    ];

    const partial = applyJournalRecordResult(rows as never, {
      terminalError: null,
      taskStatus: 'done',
      output: {
        recorded: [{ learning: 'A', nodeId: 'node-a' }],
        failed: [{ learning: 'B', reason: 'validation' }],
      },
    });
    expect(partial.recorded[0].id).toBe('r1');
    expect(partial.failed[0]).toEqual({ id: 'r2', reason: 'validation' });

    const chunkFailure = applyJournalRecordResult(rows as never, {
      terminalError: 'transport down',
      taskStatus: 'failed',
      output: null,
    });
    expect(chunkFailure.recorded).toEqual([]);
    expect(chunkFailure.failed).toEqual([
      { id: 'r1', reason: 'transport down' },
      { id: 'r2', reason: 'transport down' },
    ]);
  });
});
