import 'dotenv/config';
import { getDb, getSql, type Db } from '@/db/client';
import { agentTier } from '@/db/schema/config';
import { AGENT_TIER } from '@/db/enums';

/**
 * Config seed (Spec 2 §Data model `agent_tier`): ensure the three tier keys
 * (`main`, `complex`, `standard`) always exist with NULL provider + NULL model,
 * so the roster tab has exactly 3 rows to read and UPDATE by `tier`. The roster
 * route never inserts/deletes tier rows — it only UPDATEs these seeded rows.
 *
 * Idempotent: `ON CONFLICT (tier) DO NOTHING` so re-running never overwrites a
 * configured tier. The `provider`/`team_settings`/`repo` tables are NOT seeded
 * (real config/workspace data, created via the UI).
 */
export interface SeedConfigResult {
  inserted: number;
}

export async function seedAgentTiers(db: Db = getDb()): Promise<SeedConfigResult> {
  const rows = AGENT_TIER.map((tier) => ({ tier }));
  const result = await db.insert(agentTier).values(rows).onConflictDoNothing().returning({
    tier: agentTier.tier,
  });
  return { inserted: result.length };
}

// Run when invoked directly (tsx src/db/seed-config.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  seedAgentTiers()
    .then(async (res) => {
      // eslint-disable-next-line no-console
      console.log(`Seeded agent_tier rows: ${res.inserted} inserted (3 total ensured).`);
      await getSql().end();
      process.exit(0);
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('Config seed failed:', err.message);
      try {
        await getSql().end();
      } catch {
        /* ignore */
      }
      process.exit(1);
    });
}
