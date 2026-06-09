/**
 * Resolve an `MmaClientConfig` from the persisted Connections config + roster.
 *
 * Token resolution order:
 *   1. `SecretStore.get(team_settings.mma_token_ref)` (the production path).
 *   2. A dev fallback (`MMAGENT_AUTH_TOKEN` env, else `~/.multi-model/auth-token`)
 *      — used when no ref is configured yet (Spec §client + dev-fallback note).
 *
 * Base URL falls back to the app-layer loopback default when no `team_settings`
 * row exists yet (F17 — NOT a DB column default). The bearer is never logged.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MmaClientConfig } from '@/mma/client';
import type { SecretStore } from '@/secrets/secret-store';

export const DEFAULT_MMA_BASE_URL = 'http://127.0.0.1:7337';

/** The Connections fields this resolver reads (a subset of `team_settings`). */
export interface MmaSettingsRow {
  mmaBaseUrl: string | null;
  mmaTokenRef: string | null;
}

export interface ResolveMmaClientConfigArgs {
  settings: MmaSettingsRow | null;
  mainModel: string | null;
  secrets: SecretStore;
  /** Pre-resolved dev token; when omitted the env/file fallback is read lazily. */
  devTokenFallback?: string | null;
}

/**
 * Read the dev bearer fallback: `MMAGENT_AUTH_TOKEN` env, else the co-located
 * `~/.multi-model/auth-token` file (LF-trimmed). Returns null if neither exists.
 * This is a DEV convenience only — production uses the encrypted `mma_token_ref`.
 */
export function readDevTokenFallback(): string | null {
  const fromEnv = process.env.MMAGENT_AUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const home = process.env.MMA_HOME?.trim() || homedir();
  try {
    const raw = readFileSync(join(home, '.multi-model', 'auth-token'), 'utf8');
    const tok = raw.trim();
    return tok === '' ? null : tok;
  } catch {
    return null;
  }
}

export async function resolveMmaClientConfig(
  args: ResolveMmaClientConfigArgs,
): Promise<MmaClientConfig> {
  const baseUrl = args.settings?.mmaBaseUrl?.trim() || DEFAULT_MMA_BASE_URL;
  const ref = args.settings?.mmaTokenRef ?? null;

  let token: string | null = null;
  if (ref) {
    token = await args.secrets.get(ref);
    if (token === null) {
      // A configured ref that can't be resolved is an error UNLESS we have a dev
      // fallback (which keeps local dev working before the operator stores a token).
      const fallback =
        args.devTokenFallback !== undefined ? args.devTokenFallback : readDevTokenFallback();
      if (fallback) {
        token = fallback;
      } else {
        throw new Error(
          'MMA bearer token could not be resolved — the stored mma_token_ref is missing or undecryptable (FORGE_SECRET_KEY may be unavailable or changed).',
        );
      }
    }
  } else {
    token =
      args.devTokenFallback !== undefined ? args.devTokenFallback : readDevTokenFallback();
  }

  if (!token) {
    throw new Error(
      'MMA bearer token is not configured — store an MMA bearer in Connections (or set MMAGENT_AUTH_TOKEN for dev).',
    );
  }

  return { baseUrl, token, mainModel: args.mainModel };
}
