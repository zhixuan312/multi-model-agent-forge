import { groupTasksByRepo, buildForgeBranch, inferExecutePhase } from '@/build/execute-core';

describe('groupTasksByRepo', () => {
  it('groups tasks by targetRepoId and preserves order', () => {
    const tasks = [
      { id: '1', title: 'T1', orderIndex: 0, targetRepoId: 'r1', repoName: 'demo', repoPath: '/w/demo', defaultBranch: 'main', status: 'queued' },
      { id: '2', title: 'T2', orderIndex: 1, targetRepoId: 'r2', repoName: 'utils', repoPath: '/w/utils', defaultBranch: 'develop', status: 'queued' },
      { id: '3', title: 'T3', orderIndex: 2, targetRepoId: 'r1', repoName: 'demo', repoPath: '/w/demo', defaultBranch: 'main', status: 'queued' },
    ];
    const groups = groupTasksByRepo(tasks as any, 'My Project', 'abc123');
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
    const groups = groupTasksByRepo(tasks as any, 'Removal of DB', '1ae242c8');
    expect(groups[0].forgeBranch).toBe('forge/removal-of-db-1ae242c8');
    expect(groups[0].targetBranch).toBe('main');
  });
});

describe('buildForgeBranch', () => {
  it('builds kebab-case branch from project name + short id', () => {
    expect(buildForgeBranch('Removal of DB', '1ae242c8')).toBe('forge/removal-of-db-1ae242c8');
  });

  it('handles special characters', () => {
    expect(buildForgeBranch('My Project (v2)', 'abcd1234')).toBe('forge/my-project-v2-abcd1234');
  });
});

describe('inferExecutePhase', () => {
  it('returns configure when all queued', () => {
    const groups = [{ tasks: [{ status: 'queued' }, { status: 'queued' }] }];
    expect(inferExecutePhase(groups)).toBe('configure');
  });

  it('returns monitor when any executing', () => {
    const groups = [{ tasks: [{ status: 'queued' }, { status: 'executing' }] }];
    expect(inferExecutePhase(groups)).toBe('monitor');
  });

  it('returns review when all committed', () => {
    const groups = [{ tasks: [{ status: 'committed' }] }];
    expect(inferExecutePhase(groups)).toBe('review');
  });

  it('returns configure when empty', () => {
    expect(inferExecutePhase([])).toBe('configure');
  });
});
