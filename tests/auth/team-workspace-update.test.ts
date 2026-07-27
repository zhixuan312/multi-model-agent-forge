// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { updateTeamWorkspacePath } from '@/auth/teams-core';
import { createMockDb } from '../test-utils/mock-db';

/**
 * FR-8 + FR-9: a team-admin sets their own team's workspace root. The path is
 * validated against the operator base (direct sibling child, no escape) before
 * it is persisted; the stored value is the BASE-RELATIVE leaf, so a DB dump moved
 * to a host with a different base still resolves.
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

  it('saves a valid sibling child and persists the base-relative leaf', async () => {
    const db = createMockDb({
      'update:team': [{}],
      'select:team': [{ id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: 'alpha', gitTokenRef: null }],
    });
    const r = await updateTeamWorkspacePath('alpha', { teamId: 'team-1', db, base: '/forge/base', realpath: identity });
    expect(r.kind).toBe('saved');
    if (r.kind === 'saved') expect(r.workspaceRootPath).toBe('alpha');
    expect(db._assertCalled('team', 'update')).toBe(true);
  });

  it('persists the leaf even when the admin typed the full absolute path', async () => {
    // No absolute host path reaches the column — that is what breaks DB portability.
    const db = createMockDb({ 'update:team': [{}] });
    const r = await updateTeamWorkspacePath('/forge/base/alpha', {
      teamId: 'team-1',
      db,
      base: '/forge/base',
      realpath: identity,
    });
    expect(r.kind).toBe('saved');
    if (r.kind === 'saved') expect(r.workspaceRootPath).toBe('alpha');
    const set = JSON.stringify(db._callsFor('team').find((c) => c.method === 'set')?.args);
    expect(set).toContain('"alpha"');
    expect(set).not.toContain('/forge/base');
  });
});
