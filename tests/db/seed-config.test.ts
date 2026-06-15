// @vitest-environment node
import { seedAgentTiers } from '@/db/seed-config';
import { createMockDb } from '../test-utils/mock-db';

// seedAgentTiers is dependency-injected; tests run on a mock DB — no database.
describe('seedAgentTiers', () => {
  it('reports how many of the three tier rows were inserted (idempotent insert)', async () => {
    const db = createMockDb({ 'insert:agent_tier': [{ tier: 'main' }, { tier: 'complex' }, { tier: 'standard' }] });
    expect(await seedAgentTiers(db)).toEqual({ inserted: 3 });
    expect(db._assertCalled('agent_tier', 'insert')).toBe(true);
  });

  it('reports zero inserted when the tiers already exist (ON CONFLICT DO NOTHING)', async () => {
    const db = createMockDb({ 'insert:agent_tier': [] });
    expect(await seedAgentTiers(db)).toEqual({ inserted: 0 });
  });
});
