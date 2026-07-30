import { groupTasksByRepo, buildForgeBranch, inferExecutePhase } from '@/build/execute-core';

describe('groupTasksByRepo', () => {
  it('groups tasks by targetRepoId and preserves order', () => {
    const tasks = [
      { id: '1', title: 'T1', orderIndex: 0, targetRepoId: 'r1', repoName: 'demo', repoPath: '/w/demo', defaultBranch: 'main', status: 'queued' },
      { id: '2', title: 'T2', orderIndex: 1, targetRepoId: 'r2', repoName: 'utils', repoPath: '/w/utils', defaultBranch: 'develop', status: 'queued' },
      { id: '3', title: 'T3', orderIndex: 2, targetRepoId: 'r1', repoName: 'demo', repoPath: '/w/demo', defaultBranch: 'main', status: 'queued' },
    ];
    const groups = groupTasksByRepo(tasks as any, 'My Project', new Date('2026-07-31T00:00:00Z'));
    expect(groups).toHaveLength(2);
    expect(groups[0].repoId).toBe('r1');
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[0].tasks[0].title).toBe('T1');
    expect(groups[0].tasks[1].title).toBe('T3');
    expect(groups[1].repoId).toBe('r2');
    expect(groups[1].tasks).toHaveLength(1);
  });

  it('sets forgeBranch and targetBranch from defaults', () => {
    const tasks = [
      { id: '1', title: 'T1', orderIndex: 0, targetRepoId: 'r1', repoName: 'demo', repoPath: '/w', defaultBranch: 'main', status: 'queued' },
    ];
    const groups = groupTasksByRepo(tasks as any, 'Removal of DB', new Date('2026-07-31T00:00:00Z'));
    expect(groups[0].forgeBranch).toBe('mma/2026-07-31-removal-of-db');
    expect(groups[0].targetBranch).toBe('main');
  });
});

describe('buildForgeBranch', () => {
  // One `mma/<date>-<slug>` shape across every caller; no trailing short id, because
  // createProject now rejects a name whose slug collides within the team.
  it('builds mma/<created-date>-<slug>', () => {
    expect(buildForgeBranch('Removal of DB', new Date('2026-07-31T00:00:00Z'))).toBe('mma/2026-07-31-removal-of-db');
  });

  it('handles special characters', () => {
    expect(buildForgeBranch('My Project (v2)', new Date('2026-01-02T00:00:00Z'))).toBe('mma/2026-01-02-my-project-v2');
  });

  it('uses the CREATION date so retries reuse the same branch', () => {
    const created = new Date('2026-03-04T12:00:00Z');
    expect(buildForgeBranch('Same Project', created)).toBe(buildForgeBranch('Same Project', created));
    expect(buildForgeBranch('Same Project', created)).toBe('mma/2026-03-04-same-project');
  });

  it('gives text-distinct but slug-equal names the SAME branch — why uniqueness is enforced on the slug', () => {
    const d = new Date('2026-07-31T00:00:00Z');
    expect(buildForgeBranch('My Project', d)).toBe(buildForgeBranch('My/Project', d));
  });

  it('dates the branch in SGT, matching the creation date the UI shows', () => {
    // 22:00Z on the 30th is 06:00 SGT on the 31st. The project page renders "Jul 31",
    // so a UTC-dated branch would read a day behind for every project created between
    // 00:00 and 08:00 SGT.
    expect(buildForgeBranch('Night Owl', new Date('2026-07-30T22:00:00Z'))).toBe('mma/2026-07-31-night-owl');
  });
});

describe('inferExecutePhase', () => {
  it('returns configure when all queued', () => {
    const groups = [{ tasks: [{ status: 'queued' }, { status: 'queued' }] }];
    expect(inferExecutePhase(groups)).toBe('configure');
  });

  it('returns implement when any executing', () => {
    const groups = [{ tasks: [{ status: 'queued' }, { status: 'executing' }] }];
    expect(inferExecutePhase(groups)).toBe('implement');
  });

  it('returns implement when committed with a branch (executed)', () => {
    const groups = [{ tasks: [{ status: 'committed', branch: 'forge/test-abc123' }] }];
    expect(inferExecutePhase(groups)).toBe('implement');
  });

  it('returns configure when committed without a branch (plan-approved, not yet executed)', () => {
    const groups = [{ tasks: [{ status: 'committed' }] }];
    expect(inferExecutePhase(groups)).toBe('configure');
  });

  it('returns configure when empty', () => {
    expect(inferExecutePhase([])).toBe('configure');
  });
});
