/**
 * Server-side MmaClient factory: reads the singleton `settings_connection` base
 * URL + the `main`-tier model, resolves the local mma bearer, and constructs
 * an `MmaClient`. This is the ONE place a server-side client is constructed — every
 * dispatch path goes through it (the automation effects, the loop adapters, exploration,
 * and the API routes), so a change to base-url or main-model resolution lands everywhere
 * at once. The doc here used to name only two routes; there are around thirty callers.
 *
 * Falls back to the app-layer loopback default when no `settings_connection` row
 * exists yet (F17), so the health badge works pre-first-save. The main-tier model
 * comes from the engine's `config.json` (the source of truth set via the Models
 * tab) — defaulted when unconfigured so dispatches never 400 `main_model_required`.
 */
import { getDb, type Db } from '@/db/client';
import { connectionSettings } from '@/db/schema/identity';
import { MmaClient } from '@/mma/client';
import { resolveMmaClientConfig } from '@/mma/client-config';
import { readMmaTiers } from '@/mma/mma-config-reader';
import { DEFAULT_MAIN_MODEL, type MmaTiers } from '@/mma/tiers';

export interface BuildMmaClientDeps {
  db?: Db;
  /** Injectable tier reader (tests); defaults to the engine's config.json. */
  tiers?: () => MmaTiers;
}

export async function buildMmaClient(deps: BuildMmaClientDeps = {}): Promise<MmaClient> {
  const db = deps.db ?? getDb();
  const readTiers = deps.tiers ?? readMmaTiers;
  const [settings] = await db
    .select({ mmaBaseUrl: connectionSettings.mmaBaseUrl })
    .from(connectionSettings)
    .limit(1);

  const cfg = resolveMmaClientConfig({
    settings: settings ?? null,
    // MMA REQUIRES X-MMA-Main-Model on every tool route (400 main_model_required
    // otherwise). The configured `main` model is the source of truth; default to
    // the orchestrator's model when it's unset so dispatches never 400 pre-config.
    mainModel: readTiers().main?.model?.trim() || DEFAULT_MAIN_MODEL,
  });
  return new MmaClient(cfg);
}
