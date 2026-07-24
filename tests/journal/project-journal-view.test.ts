import { buildJournalLearningView } from '@/journal/project-journal-view';

describe('project journal view helpers', () => {
  it('maps project_journal rows into Reflect view rows ordered by seq', () => {
    const rows = [
      { id: 'row-2', heading: 'Second', body: 'Body 2', type: 'process', topic: 'repo', status: 'kept', seq: 1, recordedNodeId: null },
      { id: 'row-1', heading: 'First', body: 'Body 1', type: 'decision', topic: 'repo', status: 'proposed', seq: 0, recordedNodeId: null },
    ];

    const view = buildJournalLearningView(rows as never);
    expect(view.map((item) => item.id)).toEqual(['row-1', 'row-2']);
    expect(view[0].title).toBe('First');
    expect(view[1].status).toBe('kept');
  });

  it('keeps removed rows out of the visible list and preserves recorded node ids', () => {
    const rows = [
      { id: 'a', heading: 'Keep me', body: 'A', type: 'knowledge', topic: 'core', status: 'recorded', seq: 0, recordedNodeId: 'node-1' },
      { id: 'b', heading: 'Hide me', body: 'B', type: 'process', topic: 'core', status: 'removed', seq: 1, recordedNodeId: null },
    ];

    const view = buildJournalLearningView(rows as never);
    expect(view).toHaveLength(1);
    expect(view[0].id).toBe('a');
    expect(view[0].recordedNodeId).toBe('node-1');
  });

  it('preserves recorded status and recorded node ids', () => {
    const [row] = buildJournalLearningView([
      { id: 'r1', heading: 'Recorded', body: 'Body', type: 'knowledge', topic: 'core-api', status: 'recorded', seq: 0, recordedNodeId: 'node-7' },
    ] as never);

    expect(row.status).toBe('recorded');
    expect(row.recordedNodeId).toBe('node-7');
  });
});
