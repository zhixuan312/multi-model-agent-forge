import { normalizeProjectJournalTopic } from '@/journal/project-journal-topic';

export interface JournalRowForRecord {
  id: string;
  body: string;
  topic: string;
  seq: number;
}

export function buildJournalRecordChunks(rows: JournalRowForRecord[]) {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const chunks: Array<{ rows: JournalRowForRecord[]; body: { type: 'journal_record'; records: Array<{ prompt: string; topic: string }> } }> = [];
  for (let index = 0; index < ordered.length; index += 20) {
    const slice = ordered.slice(index, index + 20);
    chunks.push({
      rows: slice,
      body: {
        type: 'journal_record',
        records: slice.map((row) => ({ prompt: row.body, topic: normalizeProjectJournalTopic(row.topic) })),
      },
    });
  }
  return chunks;
}

export function correlateChunkRows(
  rows: JournalRowForRecord[],
  result: { recorded?: Array<{ learning: string; nodeId: string }>; failed?: Array<{ learning: string; reason: string }> },
) {
  const remaining = [...rows].sort((a, b) => a.seq - b.seq);
  const takeMatch = (learning: string) => {
    const index = remaining.findIndex((row) => row.body === learning);
    return index >= 0 ? remaining.splice(index, 1)[0] : null;
  };

  return {
    recorded: (result.recorded ?? []).map((entry) => ({ ...takeMatch(entry.learning), nodeId: entry.nodeId })).filter(Boolean),
    failed: (result.failed ?? []).map((entry) => ({ ...takeMatch(entry.learning), reason: entry.reason })).filter(Boolean),
  };
}
