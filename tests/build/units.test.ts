// @vitest-environment node
import { slugRefComponent } from '@/build/slug';
import { safeChildEnv, SECRET_ENV_KEYS } from '@/build/command-runner';

describe('slug helpers', () => {
  it('slugs ref-illegal chars and collapses repeats', () => {
    expect(slugRefComponent('My Repo!!')).toBe('my-repo');
    expect(slugRefComponent('a-_-b')).toBe('a-_-b'); // dashes/underscores kept verbatim mid-string
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
