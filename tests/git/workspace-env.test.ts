// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { WorkspaceService, type GitRunner } from '@/git/workspace';

/**
 * The git child inherited the FULL parent environment. That matters because `pull` runs
 * the repo's LOCAL hooks, and the repos Forge pulls are the same checkouts MMA workers
 * write to — so a planted `.git/hooks/post-merge` would execute with Forge's master
 * secret key and database URL in its environment.
 *
 * `safeChildEnv` already exists for the build/test subprocess boundary; the same
 * reasoning applies here, with the askpass variables added back AFTER scrubbing.
 */
describe('git subprocesses do not inherit Forge secrets', () => {
  const capture = (): { runner: GitRunner; envs: Record<string, string>[] } => {
    const envs: Record<string, string>[] = [];
    const runner: GitRunner = async (_argv, opts) => {
      envs.push(opts.env);
      return { code: 0, stdout: 'abc123', stderr: '' };
    };
    return { runner, envs };
  };

  const withEnv = async (fn: () => Promise<void>) => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      FORGE_SECRET_KEY: 'master-key',
      DATABASE_URL: 'postgres://u:p@h/db',
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-oai',
      PATH: '/usr/bin',
      HOME: '/home/node',
    });
    try { await fn(); } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  };

  it('scrubs credentials from a clone', async () => {
    await withEnv(async () => {
      const { runner, envs } = capture();
      const svc = new WorkspaceService({ workspaceRoot: '/tmp/forge-ws-test', gitRunner: runner });
      await svc.cloneRepo({ url: 'https://github.com/o/r.git', name: 'r' });
      expect(envs.length).toBeGreaterThan(0);
      for (const env of envs) {
        expect(env).not.toHaveProperty('FORGE_SECRET_KEY');
        expect(env).not.toHaveProperty('DATABASE_URL');
        expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
        expect(env).not.toHaveProperty('OPENAI_API_KEY');
        expect(env.PATH).toBe('/usr/bin');   // git still needs to be findable
        expect(env.HOME).toBe('/home/node'); // and ~/.gitconfig readable
        expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      }
    });
  });

  it('still supplies the askpass token, added back after the scrub', async () => {
    await withEnv(async () => {
      const { runner, envs } = capture();
      const svc = new WorkspaceService({ workspaceRoot: '/tmp/forge-ws-test', gitRunner: runner });
      await svc.pullRepo({ name: 'r', pathOnDisk: '/tmp/forge-ws-test/r', token: 'ghp_secret' });
      for (const env of envs) {
        expect(env.FORGE_GIT_TOKEN).toBe('ghp_secret');
        expect(env.GIT_ASKPASS).toBeTruthy();
        expect(env).not.toHaveProperty('FORGE_SECRET_KEY');
      }
    });
  });
});
