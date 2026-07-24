import { correlateChunkRows, type JournalRowForRecord } from '@/journal/journal-record-request';

export function applyJournalRecordResult(
  rows: Array<JournalRowForRecord & { status: 'kept' | 'recorded' | 'removed' | 'proposed' }>,
  envelope: {
    terminalError: string | null;
    taskStatus: string;
    output: { recorded?: Array<{ learning: string; nodeId: string }>; failed?: Array<{ learning: string; reason: string }> } | null;
  },
) {
  if (envelope.terminalError || envelope.taskStatus === 'failed' || !envelope.output) {
    const reason = envelope.terminalError ?? 'journal_record failed before returning per-row results';
    return { recorded: [] as Array<{ id: string; nodeId: string }>, failed: rows.map((row) => ({ id: row.id, reason })) };
  }

  const correlated = correlateChunkRows(rows, envelope.output);
  return {
    recorded: correlated.recorded.map((row) => ({ id: row.id, nodeId: row.nodeId })).filter(Boolean),
    failed: correlated.failed.map((row) => ({ id: row.id, reason: row.reason })).filter(Boolean),
  };
}
