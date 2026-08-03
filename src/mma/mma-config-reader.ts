/**
 * @file Reads the CURRENT per-tier config from mma's `config.json` for the Models
 * page to display. mma owns + auto-persists this file when a tier is
 * configured via `/configure-provider`, so it is the source of truth — Forge
 * never writes it. Auth is shown as `api-key` when the agent carries an
 * `apiKeyEnv`, else `oauth` (the subscription/default path).
 *
 * `next build` emits one warning against this module — "Encountered unexpected file in NFT
 * list … the whole project was traced unintentionally" — because it reads a path built from
 * the MMA home, which the file tracer cannot resolve statically. It is a warning, not an
 * error, and it is INHERENT: the MMA home is wherever the operator mounts it, so the path
 * cannot be scoped to a project subfolder as the message suggests. `/* turbopackIgnore *\/`
 * does not apply either — that annotation is for dynamic `import()`/`require()`, not `fs`
 * calls; adding it here changes nothing (verified against a real build). Recorded so the next
 * reader does not spend the same half hour on it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mmaHomePath } from '@/mma/mma-home';
import { TIERS, type MmaTiers } from '@/mma/tiers';

// The tier vocabulary lives in `@/mma/tiers` — a module with no Node imports, because a
// client component needs it and THIS module reads the filesystem. Not re-exported from here:
// one way in, per development-mode.md.

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

/**
 * Resolve the config path: `MMA_CONFIG_PATH` if it exists, else `<MMA_HOME|$HOME>/.mma/`.
 *
 * The fallback was `homedir()` alone, ignoring `MMA_HOME` — while the bearer reader beside
 * it honoured MMA_HOME, and `.env.example` documents this very default as
 * `<MMA_HOME|$HOME>/.mma/config.json`. They agree only when MMA_HOME equals $HOME, which is
 * the case where it does nothing.
 */
function mmaConfigPath(): string {
  const env = process.env.MMA_CONFIG_PATH?.trim();
  if (env && existsSync(env)) return env;
  return mmaHomePath('config.json');
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
