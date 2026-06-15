/**
 * Resolve an `MmaClientConfig` from the persisted Connections base URL + the
 * local mma bearer.
 *
 * The bearer is owned by mma, NOT Forge: it is read from `MMA_AUTH_TOKEN`
 * (env), else the co-located `~/.mma/auth-token` file that mma writes.
 * Forge never stores or mutates it — the Connections page shows it read-only. It
 * is the single source of the MMA bearer and is never logged.
 *
 * Base URL falls back to the loopback default when no settings row exists yet
 * (F17 — NOT a DB column default).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MmaClientConfig } from '@/mma/client';

export const DEFAULT_MMA_BASE_URL = 'http://127.0.0.1:7337';

/** The Connections field this resolver reads (a subset of `settings_connection`). */
export interface MmaSettingsRow {
  mmaBaseUrl: string | null;
}

export interface ResolveMmaClientConfigArgs {
  settings: MmaSettingsRow | null;
  mainModel: string | null;
  /** Pre-resolved bearer; when omitted the env/file source is read lazily. */
  bearer?: string | null;
}

/**
 * Read the local mma bearer: `MMA_AUTH_TOKEN` env, else the co-located
 * `~/.mma/auth-token` file (trimmed). Returns null if neither exists.
 * mma writes the file; Forge only reads it.
 */
export function readMmaBearer(): string | null {
  const fromEnv = process.env.MMA_AUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const home = process.env.MMA_HOME?.trim() || homedir();
  try {
    const raw = readFileSync(join(home, '.mma', 'auth-token'), 'utf8');
    const tok = raw.trim();
    return tok === '' ? null : tok;
  } catch {
    return null;
  }
}

export function resolveMmaClientConfig(args: ResolveMmaClientConfigArgs): MmaClientConfig {
  const baseUrl = args.settings?.mmaBaseUrl?.trim() || DEFAULT_MMA_BASE_URL;
  const token = args.bearer !== undefined ? args.bearer : readMmaBearer();
  if (!token) {
    throw new Error(
      'MMA bearer not found — start mma (it writes ~/.mma/auth-token) or set MMA_AUTH_TOKEN.',
    );
  }
  return { baseUrl, token, mainModel: args.mainModel };
}
