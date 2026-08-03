import { describe, it, expect, vi } from 'vitest';
import { createBuildPr, type BuildPrDeps } from '@/build/pr';

function mockDeps(overrides: Partial<BuildPrDeps> = {}): BuildPrDeps {
  return {
    readGitToken: vi.fn().mockResolvedValue('ghp_test123'),
    parseRemote: vi.fn().mockReturnValue({ owner: 'org', repo: 'r' }),
    branchHasChanges: vi.fn().mockResolvedValue(true),
    fetch: vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: 'https://github.com/org/r/pull/1' }),
      text: async () => '',
    }) as unknown as typeof globalThis.fetch,
    ...overrides,
  };
}

describe('createBuildPr', () => {
  it('creates PR with correct title for 1 task', async () => {
    const deps = mockDeps();
    const result = await createBuildPr(deps, {
      projectName: 'My Project',
      branch: 'build/my-project-abc12345',
      targetBranch: 'main',
      repoPath: '/repo',
      tasks: [{ title: 'Add validation', commitSha: 'abc123def' }],
    });
    expect(result).toEqual({ url: 'https://github.com/org/r/pull/1' });
    const body = JSON.parse((deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.title).toBe('build(My Project): Add validation');
    expect(body.head).toBe('build/my-project-abc12345');
    expect(body.base).toBe('main');
  });

  it('creates PR with +N more for 3 tasks', async () => {
    const deps = mockDeps();
    await createBuildPr(deps, {
      projectName: 'P', branch: 'b', targetBranch: 'main', repoPath: '/r',
      tasks: [{ title: 'A', commitSha: 'a' }, { title: 'B', commitSha: 'b' }, { title: 'C', commitSha: 'c' }],
    });
    const body = JSON.parse((deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.title).toBe('build(P): A + 2 more');
  });

  it('returns null when branch has no changes', async () => {
    const deps = mockDeps({ branchHasChanges: vi.fn().mockResolvedValue(false) });
    const result = await createBuildPr(deps, {
      projectName: 'P', branch: 'b', targetBranch: 'main', repoPath: '/r', tasks: [],
    });
    expect(result).toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('reports the missing git token rather than returning a bare null', async () => {
    const deps = mockDeps({ readGitToken: vi.fn().mockResolvedValue(null) });
    const result = await createBuildPr(deps, {
      projectName: 'P', branch: 'b', targetBranch: 'main', repoPath: '/r',
      tasks: [{ title: 'T', commitSha: 'a' }],
    });
    // null is reserved for "nothing to open"; a missing token is something the user can fix.
    expect(result).toMatchObject({ error: expect.stringMatching(/git token/i) });
  });

  it('reports an unreadable remote rather than returning a bare null', async () => {
    const deps = mockDeps({ parseRemote: vi.fn().mockReturnValue(null) });
    const result = await createBuildPr(deps, {
      projectName: 'P', branch: 'b', targetBranch: 'main', repoPath: '/r',
      tasks: [{ title: 'T', commitSha: 'a' }],
    });
    expect(result).toMatchObject({ error: expect.stringMatching(/remote/i) });
  });

  it('returns error when GitHub API fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'err' });
    const deps = mockDeps({ fetch: mockFetch as unknown as typeof globalThis.fetch });
    const result = await createBuildPr(deps, {
      projectName: 'P', branch: 'b', targetBranch: 'main', repoPath: '/r',
      tasks: [{ title: 'T', commitSha: 'a' }],
    });
    expect(result).toEqual({ error: expect.stringContaining('422') });
  });

  it('never calls merge endpoint', async () => {
    const deps = mockDeps();
    await createBuildPr(deps, {
      projectName: 'P', branch: 'b', targetBranch: 'main', repoPath: '/r',
      tasks: [{ title: 'T', commitSha: 'a' }],
    });
    const url = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('/pulls');
    expect(url).not.toContain('/merge');
  });
});

/**
 * Both of these are ORDINARY outcomes of running execute twice, and both used to surface as
 * "GitHub PR creation failed: 422 {raw json}" — an error the user cannot act on, about a
 * situation that is not a failure.
 */
describe('createBuildPr — the two 422s a re-run produces', () => {
  const args = {
    projectName: 'P', branch: 'mma/2026-07-01-p', targetBranch: 'main', repoPath: '/r',
    tasks: [{ title: 'A', commitSha: 'a' }],
  };
  const respond = (r: { ok: boolean; status?: number; body?: unknown; text?: string }) => ({
    ok: r.ok,
    status: r.status ?? 200,
    json: async () => r.body,
    text: async () => r.text ?? '',
  });

  /**
   * `buildForgeBranch` uses the project's CREATION date precisely so retries reuse the
   * branch. So the second execute run on every project opens a PR for a head that already
   * has one. That is success — and the URL of the existing PR is the answer the caller needs.
   */
  it('returns the EXISTING pull request rather than an error', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(respond({ ok: false, status: 422, text: '{"errors":[{"message":"A pull request already exists for org:mma/2026-07-01-p."}]}' }))
      .mockResolvedValueOnce(respond({ ok: true, body: [{ html_url: 'https://github.com/org/r/pull/7' }] }));
    const deps = mockDeps({ fetch: fetch as unknown as typeof globalThis.fetch });

    expect(await createBuildPr(deps, args)).toEqual({ url: 'https://github.com/org/r/pull/7' });

    const lookup = fetch.mock.calls[1]![0] as string;
    expect(lookup).toContain('state=open');
    expect(lookup).toContain(encodeURIComponent('org:mma/2026-07-01-p'));
  });

  it('falls back to the error when the existing PR cannot be found', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(respond({ ok: false, status: 422, text: 'A pull request already exists' }))
      .mockResolvedValueOnce(respond({ ok: true, body: [] }));
    const result = await createBuildPr(mockDeps({ fetch: fetch as unknown as typeof globalThis.fetch }), args);
    expect(result).toMatchObject({ error: expect.stringContaining('422') });
  });

  /**
   * An execute run that committed nothing. `null` — "there was legitimately nothing to
   * open" — is this function's own documented third state, and no caller could reach it:
   * `execute-pipeline` passes `branchHasChanges: async () => true`. GitHub is authoritative
   * about it regardless.
   */
  it('reports an empty branch as nothing-to-open, not as a failure', async () => {
    const fetch = vi.fn().mockResolvedValue(
      respond({ ok: false, status: 422, text: '{"message":"Validation Failed","errors":[{"message":"No commits between main and mma/2026-07-01-p"}]}' }),
    );
    expect(await createBuildPr(mockDeps({ fetch: fetch as unknown as typeof globalThis.fetch }), args)).toBeNull();
  });

  it('still reports a 422 it does not recognise', async () => {
    const fetch = vi.fn().mockResolvedValue(respond({ ok: false, status: 422, text: '{"message":"Validation Failed","errors":[{"field":"base"}]}' }));
    const result = await createBuildPr(mockDeps({ fetch: fetch as unknown as typeof globalThis.fetch }), args);
    expect(result).toMatchObject({ error: expect.stringContaining('422') });
  });

  it('does not go looking for an existing PR on a non-422', async () => {
    const fetch = vi.fn().mockResolvedValue(respond({ ok: false, status: 401, text: 'Bad credentials' }));
    const result = await createBuildPr(mockDeps({ fetch: fetch as unknown as typeof globalThis.fetch }), args);
    expect(result).toMatchObject({ error: expect.stringContaining('401') });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
