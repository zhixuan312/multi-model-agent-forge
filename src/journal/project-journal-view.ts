export interface ProjectJournalViewRow {
  id: string;
  heading: string;
  body: string;
  type: 'decision' | 'design' | 'behavior' | 'process' | 'knowledge' | 'style';
  topic: string;
  status: 'proposed' | 'kept' | 'removed' | 'recorded';
  seq: number;
  recordedNodeId: string | null;
}

export function buildJournalLearningView(rows: ProjectJournalViewRow[]) {
  return [...rows]
    .sort((a, b) => a.seq - b.seq)
    .filter((row) => row.status !== 'removed')
    .map((row, index) => ({
      id: row.id,
      num: index + 1,
      title: row.heading,
      body: row.body,
      category: row.type,
      // No `source`: it was the literal 'Manual' on every row, and the list rendered it
      // beside the category chip. Both writers of `project_journal` are machine paths —
      // the MMA harvest handler and the legacy backfill — so nothing is user-added, and
      // the label told the user the opposite of the truth on every learning.
      status: row.status as 'proposed' | 'kept' | 'recorded',
      recordedNodeId: row.recordedNodeId,
    }));
}
