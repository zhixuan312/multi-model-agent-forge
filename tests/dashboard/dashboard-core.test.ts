// @vitest-environment node
/**
 * `dashboard-core` had no test at all, which is how three of its signals came to say
 * something other than what they measured:
 *
 *   - `latestArtifact.version` was the literal `1` for every project, so the project
 *     card printed "Spec v1" for a spec on its fourteenth revision;
 *   - the `active` metric was `phase !== 'learn'`, which counts COMPLETED projects —
 *     `details/write.ts` sets `phase: 'completed'`, and the store holds such rows;
 *   - `auditsNeedingFix` (then `openAuditIssues`) counts audited STAGES whose latest
 *     pass came back `revised`, never findings.
 */
import { vi } from 'vitest';
import type { DashboardProject } from '@/dashboard/dashboard-core';

const files = vi.hoisted(() => ({
  readPlanFile: vi.fn(async (_id: string) => null as { version: number; bodyMd: string } | null),
  readSpecFile: vi.fn(async (_id: string) => null as { version: number; bodyMd: string } | null),
  readExplorationFile: vi.fn(async (_id: string) => null as { version: number; bodyMd: string } | null),
}));
vi.mock('@/projects/project-files', () => files);

const projects = vi.hoisted(() => ({
  visibleProjects: vi.fn(async () => [] as unknown[]),
  archivedProjects: vi.fn(async () => [] as unknown[]),
}));
vi.mock('@/projects/projects-core', () => projects);

const { dashboardProjects, dashboardMetrics } = await import('@/dashboard/dashboard-core');
import { createMockDb } from '../test-utils/mock-db';
import { buildInitialDetails } from '@/details/schema';

const ACTOR = { id: 'm1', teamId: 'team-1' };

function listItem(over: Partial<{ id: string; phase: string; currentStage: string }> = {}) {
  return {
    id: 'p1',
    name: 'P',
    phase: 'design',
    currentStage: 'spec',
    ownerId: 'm1',
    ...over,
  };
}

beforeEach(() => {
  for (const f of Object.values(files)) f.mockReset();
  files.readPlanFile.mockResolvedValue(null);
  files.readSpecFile.mockResolvedValue(null);
  files.readExplorationFile.mockResolvedValue(null);
});

describe('dashboardProjects — latestArtifact', () => {
  it('reports the artifact’s REAL version, not a literal 1', async () => {
    projects.visibleProjects.mockResolvedValue([listItem()]);
    files.readSpecFile.mockResolvedValue({ version: 14, bodyMd: '## 01. Context' });
    const db = createMockDb({
      'select:project': [{ id: 'p1', details: buildInitialDetails(), ownerId: 'm1' }],
      'select:ops_mma_batch': [],
      'select:team_member': [],
    });

    const [row] = await dashboardProjects(ACTOR, { db });
    expect(row!.latestArtifact).toEqual({ kind: 'spec', version: 14 });
  });

  it('prefers the furthest-along artifact and carries ITS version', async () => {
    projects.visibleProjects.mockResolvedValue([listItem()]);
    files.readPlanFile.mockResolvedValue({ version: 3, bodyMd: '## Phase one' });
    files.readSpecFile.mockResolvedValue({ version: 14, bodyMd: 'x' });
    const db = createMockDb({
      'select:project': [{ id: 'p1', details: buildInitialDetails(), ownerId: 'm1' }],
      'select:ops_mma_batch': [],
      'select:team_member': [],
    });

    const [row] = await dashboardProjects(ACTOR, { db });
    expect(row!.latestArtifact).toEqual({ kind: 'plan', version: 3 });
    // and it stops looking once it has one — the spec read never happens
    expect(files.readSpecFile).not.toHaveBeenCalled();
  });
});

describe('dashboardMetrics', () => {
  const p = (over: Partial<DashboardProject>): DashboardProject =>
    ({
      phase: 'design',
      awaitingHuman: 0,
      auditsNeedingFix: 0,
      agentsRunning: 0,
      ...over,
    }) as DashboardProject;

  it('does not count a completed project as active', () => {
    const m = dashboardMetrics([
      p({ phase: 'design' }),
      p({ phase: 'build' }),
      p({ phase: 'completed' }),
      p({ phase: 'learn' }),
    ]);
    // `phase !== 'learn'` alone returned 3 here.
    expect(m.active).toBe(2);
  });

  it('counts projects, not signals, for each attention metric', () => {
    const m = dashboardMetrics([
      p({ awaitingHuman: 5 }),
      p({ awaitingHuman: 2, auditsNeedingFix: 2 }),
      p({ agentsRunning: 4 }),
      p({ phase: 'build' }),
    ]);
    expect(m.awaitingHuman).toBe(2);
    expect(m.auditIssues).toBe(1);
    expect(m.agentsRunning).toBe(1);
    expect(m.inBuild).toBe(1);
  });
});
