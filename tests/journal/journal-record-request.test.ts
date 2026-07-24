import { buildJournalRecordChunks, correlateChunkRows } from '@/journal/journal-record-request';

describe('journal record request helpers', () => {
  it('chunks kept rows into 20-record records[] payloads and preserves order', () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `row-${index}`,
      body: `Learning ${index}`,
      topic: 'core-api',
      seq: index,
    }));

    const chunks = buildJournalRecordChunks(rows as never);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].body.records).toHaveLength(20);
    expect(chunks[1].body.records).toHaveLength(1);
    expect(chunks[0].body.records[0]).toEqual({ prompt: 'Learning 0', topic: 'core-api' });
  });

  it('matches returned learning text back to chunk rows, not array position', () => {
    const rows = [
      { id: 'a', body: 'same', topic: 'core', seq: 0 },
      { id: 'b', body: 'same', topic: 'core', seq: 1 },
      { id: 'c', body: 'other', topic: 'core', seq: 2 },
    ];

    const result = correlateChunkRows(rows as never, {
      recorded: [{ learning: 'same', nodeId: 'node-1' }],
      failed: [{ learning: 'same', reason: 'duplicate' }, { learning: 'other', reason: 'transport' }],
    });

    expect(result.recorded.map((row) => row.id)).toEqual(['a']);
    expect(result.failed.map((row) => row.id)).toEqual(['b', 'c']);
  });
});
