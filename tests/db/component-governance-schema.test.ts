import { getTableColumns, getTableName } from 'drizzle-orm';
import { componentGovernanceSettings } from '@/db/schema/identity';
import * as schema from '@/db/schema';

describe('component governance schema', () => {
  it('defines the singleton component_governance table', () => {
    expect(getTableName(componentGovernanceSettings)).toBe('component_governance');
    const cols = getTableColumns(componentGovernanceSettings);
    expect(cols.slotStateJson.name).toBe('slot_state_json');
    expect(cols.createdAt.name).toBe('created_at');
    expect(cols.updatedAt.name).toBe('updated_at');
  });

  it('re-exports the singleton table from the schema barrel', () => {
    expect(schema.componentGovernanceSettings).toBe(componentGovernanceSettings);
  });
});
