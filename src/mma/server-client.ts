/**
 * Server-side MmaClient factory: reads the singleton `settings_connection` base
 * URL + the `main`-tier model, resolves the local mma bearer, and constructs
 * an `MmaClient`. Used by the mma-health / rod routes.
 *
 * Falls back to the app-layer loopback default when no `settings_connection` row
 * exists yet (F17), so the health badge works pre-first-save.
 */
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { teamSettings, agentTier } from '@/db/schema/config';
import { MmaClient } from '@/mma/client';
import { resolveMmaClientConfig } from '@/mma/client-config';
import { DEFAULT_MAIN_MODEL } from '@/anthropic/client';

export interface BuildMmaClientDeps {
  db?: Db;
}

export async function buildMmaClient(deps: BuildMmaClientDeps = {}): Promise<MmaClient> {
  const db = deps.db ?? getDb();
  const [settings] = await db
    .select({ mmaBaseUrl: teamSettings.mmaBaseUrl })
    .from(teamSettings)
    .limit(1);
  const [mainRow] = await db
    .select({ model: agentTier.model })
    .from(agentTier)
    .where(eq(agentTier.tier, 'main'))
    .limit(1);

  const cfg = resolveMmaClientConfig({
    settings: settings ?? null,
    // MMA REQUIRES X-MMA-Main-Model on every tool route (400 main_model_required
    // otherwise). The roster `main` model is the source of truth; default to the
    // orchestrator's model when it's unset so dispatches never 400 pre-config.
    mainModel: mainRow?.model?.trim() || DEFAULT_MAIN_MODEL,
  });
  return new MmaClient(cfg);
}
