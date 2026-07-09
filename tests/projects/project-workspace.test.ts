// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';
import { resolveProjectWorkspaceRoot } from '@/projects/project-workspace';
import { createMockDb } from '../test-utils/mock-db';

describe('resolveProjectWorkspaceRoot (the team-scoped cwd for a project dispatch)', () => {
  it("resolves a project to its team's absolute workspace root", async () => {
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
