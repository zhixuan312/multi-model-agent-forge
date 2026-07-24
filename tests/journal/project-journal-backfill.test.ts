import { normalizeProjectJournalTopic, deriveDefaultProjectJournalTopic } from '@/journal/project-journal-topic';
import { buildBackfillRows } from '@/journal/project-journal-backfill';

describe('project journal topic and backfill helpers', () => {
  it('normalizes topics to lowercase kebab and falls back to unscoped', () => {
    expect(normalizeProjectJournalTopic('Core API')).toBe('core-api');
    expect(normalizeProjectJournalTopic('___')).toBe('unscoped');
    expect(deriveDefaultProjectJournalTopic([{ slug: 'Repo One' }])).toBe('repo-one');
    expect(deriveDefaultProjectJournalTopic([{ slug: '___' }])).toBe('unscoped');
    expect(deriveDefaultProjectJournalTopic([])).toBe('unscoped');
  });

  it('builds ordered, idempotent backfill rows from legacy learnings', () => {
    const rows = buildBackfillRows({
      projectId: 'proj-1',
      repos: [{ slug: 'Forge UI' }],
      learnings: [
        { heading: 'First', type: 'decision', status: 'proposed' },
        { heading: 'Second', type: 'insight', status: 'recorded' },
      ],
    });

    expect(rows.map((row) => row.seq)).toEqual([0, 1]);
    expect(rows[0].topic).toBe('forge-ui');
    expect(rows[0].body).toContain('Legacy reflect learning migrated on 2026-07-24.');
    expect(rows[1].type).toBe('knowledge');
    expect(rows[1].status).toBe('recorded');
    expect(rows[1].recordedNodeId).toBeNull();
  });
});
