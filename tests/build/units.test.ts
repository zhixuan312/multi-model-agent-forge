// @vitest-environment node
import { slugRefComponent, branchName, projectShortId } from '@/build/slug';
import { safeChildEnv, SECRET_ENV_KEYS } from '@/build/command-runner';
import { GitOps } from '@/build/branch';

describe('slug + branch naming', () => {
  it('slugs ref-illegal chars and collapses repeats', () => {
    expect(slugRefComponent('My Repo!!')).toBe('my-repo');
    expect(slugRefComponent('a-_-b')).toBe('a-_-b'); // dashes/underscores kept verbatim mid-string
  });
  it('builds forge/<short-id>/<repo> branch name', () => {
    expect(branchName('abcd1234-0000-0000-0000-0000', 'My Repo')).toBe('forge/abcd1234/my-repo');
    expect(projectShortId('abcd1234-xyz')).toBe('abcd1234');
  });

  it('GitOps.collisionCheck flags two names sanitizing to one slug (F22)', () => {
    expect(GitOps.collisionCheck(['my-repo', 'my_repo'])).toBeNull(); // - and _ are both kept, distinct
    const hit = GitOps.collisionCheck(['My Repo', 'my repo']);
    expect(hit).not.toBeNull();
    expect(hit?.slug).toBe('my-repo');
  });
});

describe('subprocess security (F9)', () => {
  it('safeChildEnv omits Forge secrets', () => {
    const env = safeChildEnv({
      PATH: '/usr/bin',
      FORGE_SECRET_KEY: 's',
      MMA_AUTH_TOKEN: 't',
      FORGE_GIT_TOKEN: 'g',
      DATABASE_URL: 'pg://x',
      ANTHROPIC_API_KEY: 'k',
    } as unknown as NodeJS.ProcessEnv);
    expect(env.PATH).toBe('/usr/bin');
    for (const k of SECRET_ENV_KEYS) expect(env[k]).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
