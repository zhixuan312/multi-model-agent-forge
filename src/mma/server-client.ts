/**
 * Server-side MmaClient factory: reads the singleton `team_settings` row + the
 * `main`-tier model, resolves the bearer (decrypted ref → dev fallback), and
 * constructs an `MmaClient`. Used by the mma-health / future rod routes.
 *
 * Falls back to the app-layer loopback default + dev token when no
 * `team_settings` row exists yet (F17), so the health badge works pre-first-save.
 */
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { teamSettings, agentTier } from '@/db/schema/config';
import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';
import { MmaClient } from '@/mma/client';
import { resolveMmaClientConfig } from '@/mma/client-config';

export interface BuildMmaClientDeps {
  db?: Db;
  secrets?: SecretStore;
}

export async function buildMmaClient(deps: BuildMmaClientDeps = {}): Promise<MmaClient> {
  const db = deps.db ?? getDb();
  const [settings] = await db
    .select({ mmaBaseUrl: teamSettings.mmaBaseUrl, mmaTokenRef: teamSettings.mmaTokenRef })
    .from(teamSettings)
    .limit(1);
  const [mainRow] = await db
    .select({ model: agentTier.model })
    .from(agentTier)
    .where(eq(agentTier.tier, 'main'))
    .limit(1);

  const secrets = deps.secrets ?? (await PostgresSecretStore.create({ db }));
  const cfg = await resolveMmaClientConfig({
    settings: settings ?? null,
    mainModel: mainRow?.model ?? null,
    secrets,
  });
  return new MmaClient(cfg);
}
