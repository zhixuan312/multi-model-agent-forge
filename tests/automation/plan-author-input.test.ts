import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('buildPlanAuthoringRequest', () => {
  it('fails when no linked repositories exist', async () => {
    const { buildPlanAuthoringRequest } = await import('@/automation/plan-author-input');
    await expect(buildPlanAuthoringRequest({
      repos: [],
      specPath: '/tmp/spec.md',
      specMd: '# Locked Specification',
      outputPath: '/tmp/plan.md',
    })).rejects.toThrow(/requires at least one linked repository/i);
  });

  it('fails when a repo path is blank', async () => {
    const { buildPlanAuthoringRequest } = await import('@/automation/plan-author-input');
    await expect(buildPlanAuthoringRequest({
      repos: [{ id: 'r1', name: 'forge', pathOnDisk: '   ', defaultBranch: 'main' }],
      specPath: '/tmp/spec.md',
      specMd: '# Locked Specification',
      outputPath: '/tmp/plan.md',
    })).rejects.toThrow(/forge.*non-empty/i);
  });

  it('fails when a linked repo path is not a directory', async () => {
    const { buildPlanAuthoringRequest } = await import('@/automation/plan-author-input');
    const dir = await mkdtemp(join(tmpdir(), 'forge-plan-author-'));
    const filePath = join(dir, 'repo.txt');
    cleanupPaths.push(dir);
    await writeFile(filePath, 'not a repo');

    await expect(buildPlanAuthoringRequest({
      repos: [{ id: 'r1', name: 'forge', pathOnDisk: filePath, defaultBranch: 'main' }],
      specPath: '/tmp/spec.md',
      specMd: '# Locked Specification',
      outputPath: '/tmp/plan.md',
    })).rejects.toThrow(/forge.*not a directory/i);
  });

  it('passes the spec by path and carries the validated repo list in the prompt', async () => {
    const { buildPlanAuthoringRequest } = await import('@/automation/plan-author-input');
    const repoDir = await mkdtemp(join(tmpdir(), 'forge-plan-author-repo-'));
    const normalizedRepoDir = await realpath(repoDir);
    cleanupPaths.push(repoDir);

    const result = await buildPlanAuthoringRequest({
      repos: [{ id: 'r1', name: 'forge', pathOnDisk: repoDir, defaultBranch: 'main' }],
      specPath: '/team/.mma/projects/p1/spec.md',
      specMd: '# Locked Specification\n\n## Context\n\n...',
      outputPath: '/tmp/plan.md',
    });

    expect(result).toEqual({
      // Title from the spec H1 + the validated repo list (Phase A's input).
      prompt: `Locked Specification\n\n# Linked repositories\n\n- forge (${normalizedRepoDir})`,
      // The spec is delivered by path, not inlined.
      target: { paths: ['/team/.mma/projects/p1/spec.md'] },
      outputPath: '/tmp/plan.md',
    });
  });
});
