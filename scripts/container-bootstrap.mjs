import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import postgres from 'postgres';

const DEFAULT_MODELS = {
  anthropic: { main: 'claude-opus-4-8', complex: 'claude-sonnet-4-5', standard: 'claude-haiku-4-5' },
  openai: { main: 'gpt-5.5', complex: 'gpt-5.5', standard: 'gpt-5.5' },
};

export function buildGeneratedConfig(provider, env) {
  const type = provider === 'anthropic' ? 'claude' : 'codex';
  const apiKeyEnv = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const hasApiKey = Boolean(env[apiKeyEnv] && env[apiKeyEnv].trim());
  const models = DEFAULT_MODELS[provider];

  return {
    agents: {
      main: { type, model: models.main, ...(hasApiKey ? { apiKeyEnv } : {}) },
      complex: { type, model: models.complex, ...(hasApiKey ? { apiKeyEnv } : {}) },
      standard: { type, model: models.standard, ...(hasApiKey ? { apiKeyEnv } : {}) },
    },
  };
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
