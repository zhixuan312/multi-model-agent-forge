import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { mmaBatch } from '@/db/schema/ops';

/**
 * The tenant column, and the constraint that makes it mean something.
 *
 * The uniqueness case used to read `expect(repo.name.name).toBe('name')` under the title
 * "scopes name uniqueness by team" — an assertion that the column called `name` is called
 * `name`, which is true of every column in every schema and cannot fail. The constraint the
 * title promised was never looked at, so a `unique()` narrowed back to `(name)` alone would
 * have passed: two teams could then never both have a repo called `api`, and the first team
 * to clone one would silently own that name for the whole installation.
 */
describe('tenant-owned tables gain team_id', () => {
  it('adds team_id to project', () => {
    expect(project.teamId.name).toBe('team_id');
  });

  it('adds team_id to workspace_repo', () => {
    expect(repo.teamId.name).toBe('team_id');
  });

  it('adds team_id to ops_mma_batch', () => {
    expect(mmaBatch.teamId.name).toBe('team_id');
  });

  it('scopes repo-name uniqueness to the team, not the installation', () => {
    const uniques = getTableConfig(repo).uniqueConstraints;
    expect(uniques.length, 'workspace_repo lost its unique constraint entirely').toBeGreaterThan(0);
    const cols = uniques.map((u) => u.columns.map((c) => c.name).sort().join(','));
    expect(cols, 'uniqueness must be (team_id, name) — on `name` alone, one team owning a repo name locks out every other team')
      .toContain('name,team_id');
  });

  it('indexes workspace_repo by team, so a tenant listing is not a full scan', () => {
    const indexes = getTableConfig(repo).indexes.map((i) => i.config.name);
    expect(indexes).toContain('repo_team_idx');
  });
});
