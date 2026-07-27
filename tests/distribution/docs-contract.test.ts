// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('distribution docs contract', () => {
  it('keeps the README bootstrap aligned with the real scripts and Node engine', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('Node >= 20.9.0');
    expect(readme).toContain('pnpm db:migrate');
    expect(readme).toContain('pnpm db:seed-templates');
    expect(readme).not.toMatch(/pnpm db:push(\s|$)/);
    expect(readme).not.toMatch(/pnpm db:seed(\s|$)/);
  });

  it('documents every env var Forge actually reads at runtime', () => {
    const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');

    for (const key of [
      'ANTHROPIC_API_KEY',
      'ARGON2_ITERATIONS',
      'ARGON2_MEMORY_KIB',
      'ARGON2_PARALLELISM',
      'DATABASE_URL',
      'FORGE_BUILD_BUILT_AT',
      'FORGE_BUILD_GIT_SHA',
      'FORGE_COOKIE_SECURE',
      'FORGE_DB_POOL_MAX',
      'FORGE_EXPORT_ROOT',
      'FORGE_PDF_LAUNCH_TIMEOUT_MS',
      'FORGE_PDF_MAX_QUEUE',
      'FORGE_PDF_MAX_SOURCE_BYTES',
      'FORGE_PDF_NO_SANDBOX',
      'FORGE_PDF_TIMEOUT_MS',
      'FORGE_PDF_WORKER_PATH',
      'FORGE_SECRET_KEY',
      'FORGE_TRUST_PROXY',
      'FORGE_WORKSPACE_BASE',
      'FORGE_WORKSPACE_ROOT',
      'LOGIN_RATELIMIT_MAX',
      'LOGIN_RATELIMIT_WINDOW',
      'MMA_AUTH_TOKEN',
      'MMA_BASE_URL',
      'MMA_CLIENT',
      'MMA_CONFIG_PATH',
      'MMA_FETCH_TIMEOUT',
      'MMA_HOME',
      'NODE_ENV',
      'OPENAI_API_KEY',
      'PASSWORD_MIN_LENGTH',
      'PROVIDER',
      'PUPPETEER_EXECUTABLE_PATH',
      'SESSION_ABSOLUTE_TTL',
      'SESSION_IDLE_TTL',
    ]) {
      expect(envExample).toContain(`${key}=`);
    }
  });
});
