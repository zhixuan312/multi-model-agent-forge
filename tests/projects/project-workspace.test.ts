// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';
import { resolveProjectWorkspaceRoot, resolveProjectArtifactDir } from '@/projects/project-workspace';
import { createMockDb } from '../test-utils/mock-db';

describe('resolveProjectWorkspaceRoot (the team-scoped cwd for a project dispatch)', () => {
  const BASE_ENV = process.env.FORGE_WORKSPACE_BASE;
  afterEach(() => {
    if (BASE_ENV === undefined) delete process.env.FORGE_WORKSPACE_BASE;
    else process.env.FORGE_WORKSPACE_BASE = BASE_ENV;
  });

  it('joins a base-relative stored team path onto the operator base', async () => {
    // The current storage form (migration 0019) — a leaf, not a host path.
    process.env.FORGE_WORKSPACE_BASE = '/forge/base';
    const db = createMockDb({ 'select:project': [{ workspaceRootPath: 'team-alpha' }] });
    const r = await resolveProjectWorkspaceRoot('proj-1', db as never);
    expect(r).toBe('/forge/base/team-alpha');
  });

  it("honours a LEGACY absolute stored team path verbatim (backward compatible)", async () => {
    process.env.FORGE_WORKSPACE_BASE = '/workspace';
    const db = createMockDb({ 'select:project': [{ workspaceRootPath: '/forge/base/team-alpha' }] });
    const r = await resolveProjectWorkspaceRoot('proj-1', db as never);
    expect(r).toBe('/forge/base/team-alpha');
  });

  it('resolves a legacy relative team path to absolute (MMA cwd must be absolute)', async () => {
    const db = createMockDb({ 'select:project': [{ workspaceRootPath: '.forge-workspace' }] });
    const r = await resolveProjectWorkspaceRoot('proj-1', db as never);
    expect(isAbsolute(r)).toBe(true);
    expect(r.endsWith('.forge-workspace')).toBe(true);
  });

  it('falls back to the global workspace root when the project/team is unresolved', async () => {
    const db = createMockDb({ 'select:project': [] });
    const r = await resolveProjectWorkspaceRoot('missing', db as never);
    expect(isAbsolute(r)).toBe(true);
  });
});

describe('resolveProjectArtifactDir (<teamRoot>/.mma/projects/<id>)', () => {
  it('places artifacts under the team root, beside the team journal', async () => {
    const db = createMockDb({ 'select:project': [{ workspaceRootPath: '/forge/base/team-alpha' }] });
    const dir = await resolveProjectArtifactDir('proj-1', db as never);
    expect(dir).toBe('/forge/base/team-alpha/.mma/projects/proj-1');
  });

  it('rejects a malformed projectId (path-injection guard)', async () => {
    const db = createMockDb({ 'select:project': [{ workspaceRootPath: '/forge/base/team-alpha' }] });
    await expect(resolveProjectArtifactDir('../evil', db as never)).rejects.toThrow(/Invalid projectId/);
  });
});
