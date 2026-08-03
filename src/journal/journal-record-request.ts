import { normalizeProjectJournalTopic } from '@/journal/project-journal-topic';

export interface JournalRowForRecord {
  id: string;
  body: string;
  topic: string;
  seq: number;
}

/**
 * Split the project's `kept` rows into MMA 5.13 `journal_record` request bodies of at
 * most 20 records each (FR-10), preserving ascending `seq` order across chunk
 * boundaries. `dispatch_record` dispatches these bodies sequentially; the
 * `journal-record` terminal handler correlates each result back to a row by matching
 * the returned `learning` to the row `body` (FR-11), so the chunk carries only the
 * request body — no separate row list is threaded back.
 */
/** MMA 5.13's per-request record ceiling (FR-10). Named so the loop step and the slice
 *  width cannot drift from each other or from the doc above. */
export const RECORDS_PER_CHUNK = 20;

export function buildJournalRecordChunks(rows: JournalRowForRecord[]) {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const chunks: Array<{ body: { type: 'journal_record'; records: Array<{ prompt: string; topic: string }> } }> = [];
  for (let index = 0; index < ordered.length; index += RECORDS_PER_CHUNK) {
    const slice = ordered.slice(index, index + RECORDS_PER_CHUNK);
    chunks.push({
      body: {
        type: 'journal_record',
        records: slice.map((row) => ({ prompt: row.body, topic: normalizeProjectJournalTopic(row.topic) })),
      },
    });
  }
  return chunks;
}

/**
 * Correlate a `journal_record` result's `recorded[]` back to the project's `kept`
 * rows by matching the returned `learning` to a row `body` — NOT by array position
 * (a `failed[]` entry desynchronizes indices). `seq` order disambiguates identical
 * bodies (first unmatched, lowest seq wins), and each row matches at most once.
 * Returns the (rowId → nodeId) pairs to flip to `recorded`. Rows not returned stay
 * `kept` and are retried on the next record trigger (FR-11a). The live
 * `journal-record` terminal handler is the only caller — this is the single,
 * unit-tested correlation implementation.
 */
export function correlateRecordedRows(
  keptRows: Array<{ id: string; body: string; seq: number }>,
  recorded: Array<{ learning: string; nodeId: string }>,
): Array<{ id: string; nodeId: string }> {
  const remaining = [...keptRows].sort((a, b) => a.seq - b.seq);
  const out: Array<{ id: string; nodeId: string }> = [];
  for (const rec of recorded) {
    const i = remaining.findIndex((r) => r.body === rec.learning);
    if (i < 0) continue;
    out.push({ id: remaining[i].id, nodeId: rec.nodeId });
    remaining.splice(i, 1);
  }
  return out;
}
