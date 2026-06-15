import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Reads the CURRENT per-tier config from mma's `config.json` for the Models
 * page to display. mma owns + auto-persists this file when a tier is
 * configured via `/configure-provider`, so it is the source of truth — Forge
 * never writes it. Auth is shown as `api-key` when the agent carries an
 * `apiKeyEnv`, else `oauth` (the subscription/default path).
 */
export type TierKey = 'main' | 'complex' | 'standard';

export interface TierConfig {
  dialect: string;
  model: string;
  baseUrl: string | null;
  authMode: 'oauth' | 'api-key';
}

export type MmaTiers = Record<TierKey, TierConfig | null>;

const TIERS: TierKey[] = ['main', 'complex', 'standard'];

/** Pure: map a parsed config object → the three tier views. */
export function parseMmaTiers(json: unknown): MmaTiers {
  const agents = (json as { agents?: Record<string, unknown> } | null)?.agents ?? {};
  const out: MmaTiers = { main: null, complex: null, standard: null };
  for (const t of TIERS) {
    const a = agents[t] as { type?: string; model?: string; baseUrl?: string; apiKeyEnv?: string } | undefined;
    if (a && typeof a.type === 'string' && typeof a.model === 'string') {
      out[t] = {
        dialect: a.type,
        model: a.model,
        baseUrl: typeof a.baseUrl === 'string' ? a.baseUrl : null,
        authMode: typeof a.apiKeyEnv === 'string' && a.apiKeyEnv ? 'api-key' : 'oauth',
      };
    }
  }
  return out;
}

/** Resolve the config path: `MMA_CONFIG_PATH` if it exists, else the default. */
function mmaConfigPath(): string {
  const env = process.env.MMA_CONFIG_PATH?.trim();
  if (env && existsSync(env)) return env;
  return join(homedir(), '.mma', 'config.json');
}

/** Read + parse the current tiers; any miss degrades to all-null (never throws). */
export function readMmaTiers(opts: { path?: string } = {}): MmaTiers {
  const path = opts.path ?? mmaConfigPath();
  if (!existsSync(path)) return { main: null, complex: null, standard: null };
  try {
    return parseMmaTiers(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { main: null, complex: null, standard: null };
  }
}
