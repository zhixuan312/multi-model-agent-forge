// @vitest-environment node
/**
 * `MMA_HOME` names the directory that HOLDS MMA's `.mma/`. Two readers of that one
 * directory disagreed: the bearer reader honoured the variable, the config reader used
 * `homedir()` alone. They agree only when MMA_HOME equals $HOME — the case where the
 * variable does nothing. Point it at a mounted volume, which is the reason it exists, and
 * Forge finds the token and not the config: every tier reads unconfigured on the Models
 * page and `buildMmaClient` sends DEFAULT_MAIN_MODEL instead of the configured one.
 * Nothing errors. It is just quietly the wrong model.
 */
import { homedir } from 'node:os';
import { mmaHomeDir, mmaHomePath } from '@/mma/mma-home';

const ORIGINAL = process.env.MMA_HOME;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MMA_HOME;
  else process.env.MMA_HOME = ORIGINAL;
});

describe('mmaHomeDir', () => {
  it('is MMA_HOME when set', () => {
    process.env.MMA_HOME = '/mnt/mma';
    expect(mmaHomeDir()).toBe('/mnt/mma');
    expect(mmaHomePath('auth-token')).toBe('/mnt/mma/.mma/auth-token');
    expect(mmaHomePath('config.json')).toBe('/mnt/mma/.mma/config.json');
  });

  it('falls back to the process home when it is unset or blank', () => {
    delete process.env.MMA_HOME;
    expect(mmaHomeDir()).toBe(homedir());
    process.env.MMA_HOME = '   ';
    expect(mmaHomeDir()).toBe(homedir());
  });
});

describe('the token and the config resolve to the SAME .mma directory', () => {
  it('both follow MMA_HOME', async () => {
    process.env.MMA_HOME = '/mnt/mma';
    const { defaultCandidatePaths } = await import('@/mma/model-profiles');
    // The bearer and the config are both under `<MMA_HOME>/.mma/` — that is the invariant
    // the two readers used to break. The catalog's last-resort candidate follows it too.
    expect(mmaHomePath('auth-token').startsWith('/mnt/mma/.mma/')).toBe(true);
    expect(mmaHomePath('config.json').startsWith('/mnt/mma/.mma/')).toBe(true);
    expect(defaultCandidatePaths()).toContain('/mnt/mma/.mma/model-profiles.json');
  });
});
