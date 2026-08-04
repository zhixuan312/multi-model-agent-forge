/**
 * Config + schema helpers for the container boot, imported by `container-supervisor.mjs`.
 *
 * It used to ALSO export an `ensureBootOrder` that ran config → schema → migrate → seed →
 * `node server.js`. Nothing called it: `docker/entrypoint.sh` execs the supervisor, which
 * imports the two helpers below and runs the boot itself. Two boot sequences, one of them
 * dead — and the dead one was the one with a test named "runs the container boot sequence",
 * asserting an order that omitted the MMA engine, its health gate and the skill reconcile
 * entirely. A test certifying a sequence the product never runs is worse than no test: the
 * real order was the untested one. Deleted; `tests/distribution/container-boot-order.test.ts`
 * now pins the supervisor's actual sequence.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const DEFAULT_MODELS = {
  claude: { main: 'claude-opus-4-8', complex: 'claude-sonnet-4-5', standard: 'claude-haiku-4-5' },
  codex: { main: 'gpt-5.5', complex: 'gpt-5.5', standard: 'gpt-5.5' },
};

const TIERS = ['main', 'complex', 'standard'];

/**
 * The engine's `type` is a WIRE PROTOCOL, not a vendor:
 *   claude = Anthropic-compatible API   codex = OpenAI-compatible API
 *
 * Many vendors speak one of these two protocols behind their own base URL — e.g.
 * DeepSeek, Z.ai/GLM, Kimi and MiniMax all expose Anthropic-compatible endpoints
 * and are configured as `type: claude` with a custom `baseUrl` and their own key.
 * So `anthropic`/`openai` here are protocol names (kept as friendly aliases for
 * claude/codex), and the vendor is expressed by BASE_URL_<TIER> + API_KEY_ENV_<TIER>.
 */
const PROTOCOLS = {
  claude: { type: 'claude', defaultApiKeyEnv: 'ANTHROPIC_API_KEY' },
  codex: { type: 'codex', defaultApiKeyEnv: 'OPENAI_API_KEY' },
};
const PROTOCOL_ALIASES = { anthropic: 'claude', openai: 'codex' };

/**
 * Resolve one tier's wire protocol. `PROVIDER` is the default for every tier; a
 * per-tier `PROVIDER_<TIER>` overrides it. Mixed layouts are first-class: codex and
 * claude are peers, not a default and an exception.
 */
function providerForTier(tier, provider, env) {
  const raw = (env[`PROVIDER_${tier.toUpperCase()}`] || provider || 'claude').trim().toLowerCase();
  const name = PROTOCOL_ALIASES[raw] ?? raw;
  if (!PROTOCOLS[name]) {
    throw new Error(
      `Unknown provider "${raw}" for tier "${tier}". Use "claude"/"anthropic" (Anthropic-compatible) ` +
        `or "codex"/"openai" (OpenAI-compatible). Point a tier at a specific vendor with ` +
        `BASE_URL_${tier.toUpperCase()} and API_KEY_ENV_${tier.toUpperCase()}, or mount your own ` +
        `~/.mma/config.json for a layout this generator cannot express.`,
    );
  }
  return name;
}

/**
 * @typedef {{ type: string, model: string, baseUrl?: string, apiKeyEnv?: string }} GeneratedTier
 * @typedef {{ agents: { main: GeneratedTier, complex: GeneratedTier, standard: GeneratedTier } }} GeneratedConfig
 */

/**
 * @param {string} provider
 * @param {Record<string, string | undefined>} env
 * @returns {GeneratedConfig}
 */
export function buildGeneratedConfig(provider, env) {
  /** @type {Record<string, GeneratedTier>} */
  const agents = {};

  for (const tier of TIERS) {
    const T = tier.toUpperCase();
    const name = providerForTier(tier, provider, env);
    const { type, defaultApiKeyEnv } = PROTOCOLS[name];

    // Three independent knobs per tier: protocol (above), endpoint, and key env var.
    // API_KEY_ENV_<TIER> lets a tier name ANY env var — required for vendors like
    // DeepSeek/GLM/Kimi/MiniMax that speak a standard protocol but hold their own key.
    const apiKeyEnv = (env[`API_KEY_ENV_${T}`] || '').trim() || defaultApiKeyEnv;
    const model = (env[`MODEL_${T}`] || '').trim() || DEFAULT_MODELS[name][tier];
    const baseUrl = (env[`BASE_URL_${T}`] || '').trim();
    const hasApiKey = Boolean(env[apiKeyEnv] && env[apiKeyEnv].trim());

    agents[tier] = {
      type,
      model,
      ...(baseUrl ? { baseUrl } : {}),
      // Keyless => the tier falls back to that provider's native OAuth
      // (~/.claude for claude, ~/.codex/auth.json for codex).
      ...(hasApiKey ? { apiKeyEnv } : {}),
    };
  }

  return /** @type {GeneratedConfig} */ ({ agents });
}

export async function resolveOrWriteConfig({ provider, env, homeDir = homedir(), configPathEnv = process.env.MMA_CONFIG_PATH }) {
  const configPath = configPathEnv && configPathEnv.trim() ? configPathEnv.trim() : join(homeDir, '.mma', 'config.json');
  if (existsSync(configPath)) {
    return { kind: 'mounted', path: configPath };
  }

  mkdirSync(dirname(configPath), { recursive: true });
  const config = buildGeneratedConfig(provider, env);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { kind: 'generated', path: configPath, config };
}

export async function createForgeSchema(databaseUrl) {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`create schema if not exists forge`;
  } finally {
    await sql.end();
  }
}
