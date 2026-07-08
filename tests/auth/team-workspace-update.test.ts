// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { updateTeamWorkspacePath } from '@/auth/teams-core';
import { createMockDb } from '../test-utils/mock-db';

/**
 * FR-8 + FR-9: a team-admin sets their own team's workspace root. The path is
 * validated against the operator base (direct sibling child, no escape) before
 * it is persisted; the stored value is the resolved absolute path.
 */
const identity = (p: string) => p;

describe('updateTeamWorkspacePath', () => {
  it('rejects a path that escapes the base without touching the DB', async () => {
    const db = createMockDb({});
    const r = await updateTeamWorkspacePath('/etc/evil', { teamId: 'team-1', db, base: '/forge/base', realpath: identity });
    expect(r.kind).toBe('invalid');
    expect(db._assertCalled('team', 'update')).toBe(false);
  });

  it('rejects the base itself', async () => {
    const db = createMockDb({});
    const r = await updateTeamWorkspacePath('/forge/base', { teamId: 'team-1', db, base: '/forge/base', realpath: identity });
    expect(r.kind).toBe('invalid');
  });

  it('saves a valid sibling child and persists the resolved absolute path', async () => {
    const db = createMockDb({
      'update:team': [{}],
      'select:team': [{ id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base/alpha', gitTokenRef: null }],
    });
    const r = await updateTeamWorkspacePath('alpha', { teamId: 'team-1', db, base: '/forge/base', realpath: identity });
    expect(r.kind).toBe('saved');
    if (r.kind === 'saved') expect(r.workspaceRootPath).toBe('/forge/base/alpha');
    expect(db._assertCalled('team', 'update')).toBe(true);
  });
});
