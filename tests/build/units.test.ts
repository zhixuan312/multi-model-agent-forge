// @vitest-environment node
import { inferCommands, cmdToString } from '@/build/command-inference';
import { parseExecuteEnvelope, classifyExecute, HALT_ERROR_CODES } from '@/build/execute-envelope';
import { parseReviewEnvelope, deriveVerdict } from '@/build/review';
import { slugRefComponent, branchName, projectShortId } from '@/build/slug';
import { safeChildEnv, SECRET_ENV_KEYS } from '@/build/command-runner';
import { GitOps } from '@/build/branch';

describe('command-inference (F17)', () => {
  it('Node repo with build+test scripts → <pm> run build / npm test, pm from lockfile', () => {
    const out = inferCommands({
      kind: 'node',
      packageJson: { scripts: { build: 'tsc', test: 'vitest' } },
      lockfiles: { pnpm: true },
    });
    expect(cmdToString(out.build)).toBe('pnpm run build');
    expect(cmdToString(out.test)).toBe('pnpm run test');
  });

  it('Node repo with no build script → no build command (vacuous pass)', () => {
    const out = inferCommands({ kind: 'node', packageJson: { scripts: { test: 'vitest' } }, lockfiles: {} });
    expect(out.build).toBeNull();
    expect(cmdToString(out.test)).toBe('npm test');
  });

  it('Python repo with [build-system] + pytest dep → python -m build / pytest', () => {
    const out = inferCommands({
      kind: 'python',
      pyprojectToml: '[build-system]\nrequires=["hatchling"]\n[project]\ndependencies=["pytest"]',
    });
    expect(cmdToString(out.build)).toBe('python -m build');
    expect(cmdToString(out.test)).toBe('pytest');
  });

  it('pure-script Python repo → no build command', () => {
    const out = inferCommands({ kind: 'python', pyprojectToml: '[project]\nname="x"' });
    expect(out.build).toBeNull();
    expect(out.test).toBeNull();
  });
});

describe('execute-envelope', () => {
  const committedEnv = {
    headline: 'execute_plan: 1 task(s) complete',
    costSummary: { totalActualCostUSD: 0.42 },
    results: [{ status: 'done', error: null }],
    structuredReport: { commitSha: 'ABC123', commitSkipReason: null, filesChanged: [{ path: 'a.ts', summary: 's' }], unresolved: [] },
  };

  it('parses commit payload, filesChanged, cost', () => {
    const p = parseExecuteEnvelope(committedEnv);
    expect(p.commit.commitSha).toBe('ABC123');
    expect(p.filesChanged).toEqual(['a.ts']);
    expect(p.costUsd).toBeCloseTo(0.42);
  });

  it('classifies a real commit as committed', () => {
    expect(classifyExecute(parseExecuteEnvelope(committedEnv))).toEqual({ kind: 'committed', commitSha: 'ABC123' });
  });

  it('classifies a no_op (no commitSha) as a verification failure', () => {
    const env = { structuredReport: { commitSha: null, commitSkipReason: 'no_diff', filesChanged: [], unresolved: [] } };
    expect(classifyExecute(parseExecuteEnvelope(env))).toMatchObject({ kind: 'failure' });
  });

  it('classifies an enumerated halt errorCode as halt-for-decision', () => {
    for (const code of HALT_ERROR_CODES) {
      const env = { results: [{ error: { code } }], structuredReport: { commitSha: null, filesChanged: [], unresolved: [] } };
      expect(classifyExecute(parseExecuteEnvelope(env))).toMatchObject({ kind: 'halt' });
    }
  });

  it('classifies empty filesChanged + non-empty unresolved as halt (uses filesChanged/unresolved, not filesWritten)', () => {
    const env = { structuredReport: { commitSha: null, filesChanged: [], unresolved: ['cannot resolve the auth contract'] } };
    const d = classifyExecute(parseExecuteEnvelope(env));
    expect(d).toMatchObject({ kind: 'halt' });
    if (d.kind === 'halt') expect(d.marker).toContain('cannot resolve');
  });

  it('classifies a non-halt errorCode as task failure', () => {
    const env = { results: [{ error: { code: 'provider_unavailable' } }], structuredReport: { commitSha: null, filesChanged: [], unresolved: [] } };
    expect(classifyExecute(parseExecuteEnvelope(env))).toMatchObject({ kind: 'failure' });
  });
});

describe('review verdict derivation (F4)', () => {
  it('changes_required iff ≥1 critical/high', () => {
    const env = { structuredReport: { findings: [{ severity: 'high', claim: 'x' }, { severity: 'low', claim: 'y' }] } };
    const parsed = parseReviewEnvelope(env);
    expect(parsed.findingsCount).toBe(2);
    expect(deriveVerdict(parsed)).toBe('changes_required');
  });

  it('approved when only medium/low findings', () => {
    const env = { structuredReport: { findings: [{ severity: 'medium', claim: 'x' }] } };
    expect(deriveVerdict(parseReviewEnvelope(env))).toBe('approved');
  });

  it('approved for a clean report', () => {
    const env = { structuredReport: { findings: [], findingsOutcome: 'clean' } };
    expect(deriveVerdict(parseReviewEnvelope(env))).toBe('approved');
  });

  it('error for a missing structured report', () => {
    expect(deriveVerdict(parseReviewEnvelope({}))).toBe('error');
  });
});

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
