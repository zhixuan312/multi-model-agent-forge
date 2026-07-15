import { readFileSync } from 'node:fs';

describe('component governance migration', () => {
  it('creates the singleton table and unique-on-true guard', () => {
    const sql = readFileSync('src/db/migrations/0015_component_governance.sql', 'utf8');
    expect(sql).toContain('CREATE TABLE "forge"."component_governance"');
    expect(sql).toContain('"slot_state_json" jsonb DEFAULT \'{}\'::jsonb NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX "settings_component_governance_singleton"');
  });

  it('registers the migration in the drizzle journal', () => {
    const journal = JSON.parse(readFileSync('src/db/migrations/meta/_journal.json', 'utf8'));
    const tags = (journal.entries as Array<{ tag: string }>).map((entry) => entry.tag);
    expect(tags).toContain('0015_component_governance');
  });
});
