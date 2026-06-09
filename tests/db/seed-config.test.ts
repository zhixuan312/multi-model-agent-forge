// @vitest-environment node
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { agentTier } from '@/db/schema/config';
import { seedAgentTiers } from '@/db/seed-config';
import { AGENT_TIER } from '@/db/enums';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('seedAgentTiers (live DB)', () => {
  const db = getDb();

  it('ensures exactly the 3 tier rows exist with NULL provider + NULL model', async () => {
    // The migration + the slice's db:seed already seeded these; re-running must
    // be a no-op (idempotent), never overwriting a configured tier.
    await seedAgentTiers(db);

    const rows = await db
      .select({
        tier: agentTier.tier,
        providerId: agentTier.providerId,
        model: agentTier.model,
      })
      .from(agentTier);

    const tiers = rows.map((r) => r.tier).sort();
    expect(tiers).toEqual([...AGENT_TIER].sort());
  });

  it('is idempotent — a second run inserts nothing and leaves any config intact', async () => {
    // Configure the `main` tier, re-seed, assert it was NOT reset to NULL.
    await db.update(agentTier).set({ model: '__seed_test_model__' }).where(eq(agentTier.tier, 'main'));
    const res = await seedAgentTiers(db);
    expect(res.inserted).toBe(0);

    const [main] = await db
      .select({ model: agentTier.model })
      .from(agentTier)
      .where(eq(agentTier.tier, 'main'));
    expect(main.model).toBe('__seed_test_model__');

    // Restore the seeded NULL state so we don't leave config behind.
    await db.update(agentTier).set({ model: null }).where(eq(agentTier.tier, 'main'));
  });
});
