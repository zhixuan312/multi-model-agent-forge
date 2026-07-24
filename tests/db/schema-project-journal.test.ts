import * as schema from '@/db/schema';
import { projectJournal } from '@/db/schema/project-journal';
import { readFileSync } from 'node:fs';

describe('project journal barrel export and migration journal', () => {
  it('re-exports projectJournal from the schema barrel', () => {
    expect(schema.projectJournal).toBe(projectJournal);
  });

  it('registers the 0018 migration tag in the drizzle journal', () => {
    const journal = JSON.parse(readFileSync('src/db/migrations/meta/_journal.json', 'utf8')) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.map((entry) => entry.tag)).toContain('0018_project_journal');
  });
});
