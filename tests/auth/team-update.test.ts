// @vitest-environment node
import { updateTeam } from '@/auth/teams-core';
import { createMockDb } from '../test-utils/mock-db';

const passthrough = (p: string) => p;

describe('updateTeam (org admin edits an existing team)', () => {
  it('updates the slug (re-deriving the name) and resolves + validates the workspace', async () => {
    const db = createMockDb({ 'update:team': [{ id: 'team-1' }] });
    const res = await updateTeam(
      { slug: 'renamed-squad', workspaceRootPath: 'sub' },
      { teamId: 'team-1', db, base: '/forge/base', realpath: passthrough },
    );
    expect(res.kind).toBe('saved');
    expect(db._wasCalled('team', 'update')).toBe(true);
    const setCall = db._callsFor('team').find((c) => c.method === 'set');
    const set = JSON.stringify(setCall?.args);
    expect(set).toContain('renamed-squad'); // slug
    expect(set).toContain('Renamed Squad'); // name derived from slug
    // Stored base-relative (validated against the resolved /forge/base/sub), so the
    // row survives a restore onto a host with a different FORGE_WORKSPACE_BASE.
    expect(set).toContain('"sub"');
    expect(set).not.toContain('/forge/base');
  });

  it('updates only the fields provided (slug alone re-derives the name)', async () => {
    const db = createMockDb({ 'update:team': [{ id: 'team-1' }] });
    const res = await updateTeam({ slug: 'just-name' }, { teamId: 'team-1', db });
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
    expect(db._wasCalled('team', 'update')).toBe(false);
  });

  it('rejects an empty update (no fields)', async () => {
    const db = createMockDb();
    const res = await updateTeam({}, { teamId: 'team-1', db });
    expect(res.kind).toBe('invalid');
    expect(db._calls).toHaveLength(0);
  });
});
