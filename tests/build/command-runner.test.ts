// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { safeChildEnv } from '@/build/command-runner';

/**
 * `safeChildEnv` feeds the environment of an UNTRUSTED subprocess: the build and test
 * commands a plan names, running in a project's checkout.
 *
 * It denied secrets by exact name plus the `FORGE_`/`MMA_` prefixes, which left every
 * other provider credential in place — `ANTHROPIC_API_KEY` was blocked by name while
 * `OPENAI_API_KEY`, which the container bootstrap documents just as prominently, was not.
 * Naming secrets one at a time loses to the next one added, so the shape is denied too.
 */
describe('safeChildEnv keeps credentials out of build/test subprocesses', () => {
  const SECRETY = [
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'CR_PAT',
    'NPM_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'DB_PASSWORD', 'SOME_CREDENTIALS',
    'FORGE_SECRET_KEY', 'MMA_AUTH_TOKEN', 'DATABASE_URL', 'GIT_TOKEN',
  ];

  it('drops every credential-shaped variable, not just the ones named individually', () => {
    const env = Object.fromEntries(SECRETY.map((k) => [k, 'sensitive']));
    const out = safeChildEnv(env as NodeJS.ProcessEnv);
    expect(Object.keys(out)).toEqual([]);
  });

  it('keeps what a build actually needs', () => {
    const out = safeChildEnv({
      PATH: '/usr/bin', HOME: '/home/node', LANG: 'C.UTF-8', TMPDIR: '/tmp',
      NODE_ENV: 'test', JAVA_HOME: '/jdk', PNPM_HOME: '/pnpm', CI: '1',
    });
    expect(Object.keys(out).sort()).toEqual(
      ['CI', 'HOME', 'JAVA_HOME', 'LANG', 'NODE_ENV', 'PATH', 'PNPM_HOME', 'TMPDIR'],
    );
  });
});
