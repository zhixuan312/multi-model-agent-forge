// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The declared runtime floor, e.g. ">=22.0.0". */
const enginesNode: string = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { engines: { node: string } }
).engines.node;

/** Major version out of a range like ">=22.0.0" → 22. */
function majorOf(range: string): number {
  const m = range.match(/(\d+)/);
  if (!m) throw new Error(`cannot read a major version from engines.node "${range}"`);
  return Number(m[1]);
}

describe('distribution docs contract', () => {
  it('keeps the README bootstrap aligned with the real scripts and Node engine', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    // DERIVED from package.json, never a hardcoded literal. This assertion used to spell
    // out "Node >= 20.9.0", so it kept passing while `engines`, the Dockerfile, CI and the
    // bundled engine had all moved on — locking the README to a stale number instead of to
    // the truth.
    expect(readme).toContain(`Node >= ${majorOf(enginesNode)}`);
    expect(readme).toContain('pnpm db:migrate');
    expect(readme).toContain('pnpm db:seed-templates');
    expect(readme).not.toMatch(/pnpm db:push(\s|$)/);
    expect(readme).not.toMatch(/pnpm db:seed(\s|$)/);
  });

  it('declares a Node floor the Dockerfile and CI actually run on', () => {
    // The drift this catches: `engines` said >=20.9.0 while every `FROM node:` line was 22,
    // CI used 22, and the bundled MMA engine requires >=22 — so a Node 20 install passed
    // `pnpm install` and then failed at runtime on the co-process.
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
    const bases = [...dockerfile.matchAll(/^FROM node:(\d+)/gm)].map((m) => Number(m[1]));
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) expect(base).toBeGreaterThanOrEqual(majorOf(enginesNode));
    // Every stage must agree with every other — a mixed-base image is its own bug.
    expect(new Set(bases).size).toBe(1);

    const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    for (const m of workflow.matchAll(/node-version:\s*'?(\d+)/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(majorOf(enginesNode));
    }
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

describe('GUIDELINES <-> in-app guide', () => {
  /**
   * GUIDELINES.md's "mirror note" names the `forge`-group section ids by hand. It used to
   * point at `multi-model-agent-telemetry-frontend/docs/direction-parity-checklist.md` as
   * the way to keep the two in sync — a file that does not exist in any repo, so the
   * instruction was unfollowable and nothing noticed. Derive the ids from the code instead
   * of restating them, so adding or renaming a forge guide section fails here until the
   * document is updated too.
   */
  it('names exactly the forge-group section ids that guide-nav actually defines', async () => {
    const { GUIDE_NAV_SECTIONS } = await import('@/content/guide-nav');
    const guidelines = readFileSync(join(process.cwd(), 'GUIDELINES.md'), 'utf8');

    const forgeIds = GUIDE_NAV_SECTIONS.filter((s) => s.part === 'forge').map((s) => s.id);
    expect(forgeIds.length).toBeGreaterThan(0);

    for (const id of forgeIds) {
      expect(guidelines).toContain(`\`${id}\``);
    }
    // and does not advertise a forge section that no longer exists
    const cited = [...guidelines.matchAll(/`(forge-[a-z-]+)`/g)].map((m) => m[1]);
    expect([...new Set(cited)].sort()).toEqual([...forgeIds].sort());
  });

  it('does not point at the checklist file that never existed', () => {
    const guidelines = readFileSync(join(process.cwd(), 'GUIDELINES.md'), 'utf8');
    expect(guidelines).not.toMatch(/Keep them in sync via/);
  });
});
