// @vitest-environment node
import { updateTeam } from '@/auth/teams-core';
import { createMockDb } from '../test-utils/mock-db';

const passthrough = (p: string) => p;

describe('updateTeam (org admin edits an existing team)', () => {
  it('updates name/slug and resolves + validates the workspace path', async () => {
    const db = createMockDb({ 'update:team': [{ id: 'team-1' }] });
    const res = await updateTeam(
      { name: 'Renamed', slug: 'renamed', workspaceRootPath: 'sub' },
      { teamId: 'team-1', db, base: '/forge/base', realpath: passthrough },
    );
    expect(res.kind).toBe('saved');
    expect(db._assertCalled('team', 'update')).toBe(true);
    const setCall = db._callsFor('team').find((c) => c.method === 'set');
    const set = JSON.stringify(setCall?.args);
    expect(set).toContain('Renamed');
    expect(set).toContain('renamed');
    expect(set).toContain('/forge/base/sub'); // resolved absolute path
  });

  it('updates only the fields provided', async () => {
    const db = createMockDb({ 'update:team': [{ id: 'team-1' }] });
    const res = await updateTeam({ name: 'Just Name' }, { teamId: 'team-1', db });
    expect(res.kind).toBe('saved');
    const set = JSON.stringify(db._callsFor('team').find((c) => c.method === 'set')?.args);
    expect(set).toContain('Just Name');
    expect(set).not.toContain('workspaceRootPath');
  });

  it('rejects a workspace path that escapes the operator base (no write)', async () => {
    const db = createMockDb();
    const res = await updateTeam(
      { workspaceRootPath: '../evil' },
      { teamId: 'team-1', db, base: '/forge/base', realpath: passthrough },
    );
    expect(res.kind).toBe('invalid');
    expect(db._assertCalled('team', 'update')).toBe(false);
  });

  it('rejects an empty update (no fields)', async () => {
    const db = createMockDb();
    const res = await updateTeam({}, { teamId: 'team-1', db });
    expect(res.kind).toBe('invalid');
    expect(db._calls).toHaveLength(0);
  });
});
