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
      source: 'Manual' as const,
      status: row.status as 'proposed' | 'kept' | 'recorded',
      isManual: true,
      recordedNodeId: row.recordedNodeId,
    }));
}
