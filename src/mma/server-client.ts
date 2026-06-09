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
import { DEFAULT_MAIN_MODEL } from '@/anthropic/client';

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
    // MMA REQUIRES X-MMA-Main-Model on every tool route (400 main_model_required
    // otherwise). The roster `main` model is the source of truth; default to the
    // orchestrator's model when it's unset so dispatches never 400 pre-config.
    mainModel: mainRow?.model?.trim() || DEFAULT_MAIN_MODEL,
    secrets,
  });
  return new MmaClient(cfg);
}
