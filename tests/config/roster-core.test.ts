// @vitest-environment node
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { agentTier } from '@/db/schema/config';
import { listRoster, updateRoster } from '@/config/roster-core';
import { cleanupConfig, seedTestProvider } from './config-fixtures';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('roster-core (live DB)', () => {
  const db = getDb();

  afterAll(async () => {
    await cleanupConfig();
  });

  it('lists exactly the 3 seeded tiers in canonical order', async () => {
    const rows = await listRoster({ db });
    expect(rows.map((r) => r.tier)).toEqual(['main', 'complex', 'standard']);
  });

  it('updates a tier → provider + model by tier (no insert/delete of tier rows)', async () => {
    const p = await seedTestProvider({ label: 'roster' });
    const res = await updateRoster(
      { tiers: [{ tier: 'complex', providerId: p.id, model: 'claude-opus-4-8' }] },
      { db },
    );
    expect(res.kind).toBe('updated');
    if (res.kind !== 'updated') return;

    const complex = res.roster.find((r) => r.tier === 'complex')!;
    expect(complex.providerId).toBe(p.id);
    expect(complex.model).toBe('claude-opus-4-8');

    // Still exactly 3 rows — no inserts/deletes.
    const all = await db.select().from(agentTier);
    expect(all).toHaveLength(3);
  });

  it('accepts a custom (non-catalog) model id (free text)', async () => {
    const p = await seedTestProvider({ label: 'custom' });
    const res = await updateRoster(
      { tiers: [{ tier: 'standard', providerId: p.id, model: 'MiniMax-Text-01-custom' }] },
      { db },
    );
    expect(res.kind).toBe('updated');
    const [row] = await db
      .select({ model: agentTier.model })
      .from(agentTier)
      .where(eq(agentTier.tier, 'standard'));
    expect(row.model).toBe('MiniMax-Text-01-custom');
  });

  it('clears a tier when both provider and model are null', async () => {
    const p = await seedTestProvider({ label: 'clearme' });
    await updateRoster({ tiers: [{ tier: 'main', providerId: p.id, model: 'm' }] }, { db });
    const res = await updateRoster(
      { tiers: [{ tier: 'main', providerId: null, model: null }] },
      { db },
    );
    expect(res.kind).toBe('updated');
    const [row] = await db
      .select({ providerId: agentTier.providerId, model: agentTier.model })
      .from(agentTier)
      .where(eq(agentTier.tier, 'main'));
    expect(row.providerId).toBeNull();
    expect(row.model).toBeNull();
  });

  it('rejects an invalid tier value', async () => {
    const res = await updateRoster({ tiers: [{ tier: 'worker', model: 'x' }] }, { db });
    expect(res.kind).toBe('invalid');
  });

  it('rejects a half-set tier (provider without model)', async () => {
    const p = await seedTestProvider({ label: 'half' });
    const res = await updateRoster(
      { tiers: [{ tier: 'complex', providerId: p.id, model: '' }] },
      { db },
    );
    expect(res.kind).toBe('invalid');
  });

  it('rejects an unknown provider id', async () => {
    const res = await updateRoster(
      {
        tiers: [
          { tier: 'complex', providerId: '00000000-0000-0000-0000-000000000000', model: 'm' },
        ],
      },
      { db },
    );
    expect(res.kind).toBe('unknown_provider');
  });
});
