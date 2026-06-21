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

  it('returns null when no git token', async () => {
    const deps = mockDeps({ readGitToken: vi.fn().mockResolvedValue(null) });
    const result = await createBuildPr(deps, {
      projectName: 'P', branch: 'b', targetBranch: 'main', repoPath: '/r',
      tasks: [{ title: 'T', commitSha: 'a' }],
    });
    expect(result).toBeNull();
  });

  it('returns null when remote is not GitHub', async () => {
    const deps = mockDeps({ parseRemote: vi.fn().mockReturnValue(null) });
    const result = await createBuildPr(deps, {
      projectName: 'P', branch: 'b', targetBranch: 'main', repoPath: '/r',
      tasks: [{ title: 'T', commitSha: 'a' }],
    });
    expect(result).toBeNull();
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
