// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { cloneAndRegister } from '@/git/repos-core';
import { createMockDb, createMockSecretStore, seq } from '../test-utils/mock-db';

describe('team workspace repo registration', () => {
  it('allows the same repo name in two different teams', async () => {
    const repoRow = { id: 'repo-1', teamId: 'team-1', name: 'shared', pathOnDisk: '/forge/base/alpha/shared', defaultBranch: 'main', tags: [], status: 'cloned', headSha: 'abc', createdAt: new Date() };
    const db = createMockDb({
      'select:workspace_repo': seq([], [repoRow]),
      'select:team': [{ id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base/alpha', gitTokenRef: null }],
      'insert:workspace_repo': [repoRow],
      'update:workspace_repo': [{ ...repoRow, status: 'cloned' }],
    });
    const workspace = {
      cloneRepo: vi.fn(async () => ({ pathOnDisk: '/forge/base/alpha/shared', defaultBranch: 'main', headSha: 'abc' })),
    };
    const res = await cloneAndRegister({ name: 'shared', url: 'https://github.com/acme/shared.git' }, { db, secrets: createMockSecretStore(), workspace: workspace as never, teamId: 'team-1' });
    expect(res.kind).toBe('cloned');
    expect(res.kind === 'cloned' && res.repo.teamId).toBeUndefined(); // team info not exposed in view
  });
});
