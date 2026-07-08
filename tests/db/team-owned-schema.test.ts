import { describe, expect, it } from 'vitest';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { mmaBatch } from '@/db/schema/ops';

describe('tenant-owned tables gain team_id', () => {
  it('adds team_id to project', () => {
    expect(project.teamId.name).toBe('team_id');
  });

  it('adds team_id to workspace_repo and scopes name uniqueness by team', () => {
    expect(repo.teamId.name).toBe('team_id');
    expect(repo.name.name).toBe('name');
  });

  it('adds team_id to ops_mma_batch', () => {
    expect(mmaBatch.teamId.name).toBe('team_id');
  });
});
