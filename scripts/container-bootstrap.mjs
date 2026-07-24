import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import postgres from 'postgres';

const DEFAULT_MODELS = {
  anthropic: { main: 'claude-opus-4-8', complex: 'claude-sonnet-4-5', standard: 'claude-haiku-4-5' },
  openai: { main: 'gpt-5.5', complex: 'gpt-5.5', standard: 'gpt-5.5' },
};

const TIERS = ['main', 'complex', 'standard'];

/** Provider name -> engine agent `type` + the env var holding that provider's key. */
const PROVIDERS = {
  anthropic: { type: 'claude', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  openai: { type: 'codex', apiKeyEnv: 'OPENAI_API_KEY' },
};

/**
 * Resolve one tier's provider. `PROVIDER` is the default for every tier; a
 * per-tier `PROVIDER_<TIER>` overrides it. Mixed layouts are first-class:
 * codex and claude are peers, not a default and an exception.
 */
function providerForTier(tier, provider, env) {
  const raw = (env[`PROVIDER_${tier.toUpperCase()}`] || provider || 'anthropic').trim().toLowerCase();
  if (!PROVIDERS[raw]) {
    throw new Error(
      `Unknown provider "${raw}" for tier "${tier}". Use "anthropic" or "openai", ` +
        `or mount your own ~/.mma/config.json for a layout this generator cannot express.`,
    );
  }
  return raw;
}

export function buildGeneratedConfig(provider, env) {
  const agents = {};

  for (const tier of TIERS) {
    const name = providerForTier(tier, provider, env);
    const { type, apiKeyEnv } = PROVIDERS[name];
    // Each tier names ITS OWN key env var. A tier may also override its model and
    // point at any OpenAI-compatible endpoint via a per-tier base URL.
    const model = (env[`MODEL_${tier.toUpperCase()}`] || '').trim() || DEFAULT_MODELS[name][tier];
    const baseUrl = (env[`BASE_URL_${tier.toUpperCase()}`] || '').trim();
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

  return { agents };
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

async function runCommand(label, command, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`${label} failed with exit code ${code ?? 'unknown'}`));
    });
    child.on('error', reject);
  });
}

export async function ensureBootOrder({
  databaseUrl,
  provider,
  env,
  ensureConfig = resolveOrWriteConfig,
  createSchema = createForgeSchema,
  spawnStep = async (label) => {
    if (label === 'db:migrate') await runCommand(label, 'pnpm', ['db:migrate'], env);
    if (label === 'db:seed-templates') await runCommand(label, 'pnpm', ['db:seed-templates'], env);
  },
  startServer = async () => {
    await runCommand('server', 'node', ['server.js'], env);
  },
}) {
  await ensureConfig({ provider, env });
  await createSchema(databaseUrl);
  await spawnStep('db:migrate');
  await spawnStep('db:seed-templates');
  await startServer();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const provider = process.env.PROVIDER?.trim();

  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new Error('PROVIDER must be anthropic or openai.');
  }

  await ensureBootOrder({
    databaseUrl,
    provider,
    env: process.env,
  });
}
