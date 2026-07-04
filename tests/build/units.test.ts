// @vitest-environment node
import { slugRefComponent, branchName, projectShortId } from '@/build/slug';
import { safeChildEnv, SECRET_ENV_KEYS } from '@/build/command-runner';
import { GitOps, type GitRunner, type GitRunResult } from '@/build/branch';

/** A recording git runner for GitOps tests — returns canned results by argv[0..]. */
function mockRunner(responses: Record<string, GitRunResult>): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: GitRunner = async (_repo, argv) => {
    calls.push(argv);
    // match on the leading non-`-c` git subcommand + first arg
    const key = argv.filter((a, i) => !(argv[i - 1] === '-c') && a !== '-c').slice(0, 2).join(' ');
    return responses[key] ?? { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

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

/**
 * commitAllIfDirty is the fix for the review-apply defect: a `reviewPolicy=none`
 * worker EDITS repo files but never commits, so the handler must commit before
 * pushing — else the fixes stay uncommitted (dirty tree, PR missing them).
 */
describe('GitOps.commitAllIfDirty', () => {
  it('commits all changes with an inline Forge identity and returns the new SHA when dirty', async () => {
    const { run, calls } = mockRunner({
      'status --porcelain': { code: 0, stdout: ' M backend/src/foo.ts\n', stderr: '' },
      'commit -m': { code: 0, stdout: '', stderr: '' },
      'rev-parse HEAD': { code: 0, stdout: 'abc123\n', stderr: '' },
    });
    const sha = await new GitOps(run).commitAllIfDirty('/repo', 'review: apply findings (pass 2)');
    expect(sha).toBe('abc123');
    // staged everything, then committed with an inline identity (works without repo config)
    expect(calls).toContainEqual(['add', '-A']);
    const commit = calls.find((c) => c.includes('commit'));
    expect(commit).toEqual(['-c', 'user.email=forge@forge.local', '-c', 'user.name=Forge', 'commit', '-m', 'review: apply findings (pass 2)']);
  });

  it('is a no-op (returns null, no commit) when the tree is clean', async () => {
    const { run, calls } = mockRunner({
      'status --porcelain': { code: 0, stdout: '', stderr: '' },
    });
    const sha = await new GitOps(run).commitAllIfDirty('/repo', 'noop');
    expect(sha).toBeNull();
    expect(calls.some((c) => c.includes('commit'))).toBe(false);
    expect(calls.some((c) => c.includes('add'))).toBe(false);
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
