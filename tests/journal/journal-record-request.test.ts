import { buildJournalRecordChunks, correlateRecordedRows } from '@/journal/journal-record-request';

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

  it('correlates recorded[] to rows by learning→body (not array position), seq disambiguates duplicates', () => {
    const kept = [
      { id: 'a', body: 'same', seq: 0 },
      { id: 'b', body: 'same', seq: 1 },
      { id: 'c', body: 'other', seq: 2 },
    ];
    // Only one 'same' recorded → the lowest-seq unmatched row (a) wins; b stays kept.
    const matches = correlateRecordedRows(kept, [
      { learning: 'other', nodeId: 'node-c' },
      { learning: 'same', nodeId: 'node-a' },
    ]);
    expect(matches).toEqual([
      { id: 'c', nodeId: 'node-c' },
      { id: 'a', nodeId: 'node-a' },
    ]);
  });

  it('returns no match for a learning with no matching row body', () => {
    const matches = correlateRecordedRows([{ id: 'a', body: 'x', seq: 0 }], [{ learning: 'y', nodeId: 'n' }]);
    expect(matches).toEqual([]);
  });
});
