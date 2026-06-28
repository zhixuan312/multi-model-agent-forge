export interface TaskForGrouping {
  id: string;
  title: string;
  orderIndex: number;
  targetRepoId: string;
  repoName: string;
  repoPath: string;
  defaultBranch: string;
  status: string;
  phase?: string | null;
  branch?: string | null;
  commitSha?: string | null;
}

export interface RepoGroup {
  repoId: string;
  repoName: string;
  pathOnDisk: string;
  defaultBranch: string;
  branches: string[];
  targetBranch: string;
  tasks: TaskForGrouping[];
  forgeBranch: string;
}

export type ExecutePhase = 'configure' | 'implement';

const EXECUTION_STATUSES = new Set(['executing', 'verifying', 'fixing', 'failed', 'skipped']);

export function inferExecutePhase(groups: Array<{ tasks: Array<{ status: string; branch?: string | null }> }>): ExecutePhase {
  const allTasks = groups.flatMap((g) => g.tasks);
  if (allTasks.length === 0) return 'configure';
  // A task is "executing" when it's in an execution status OR committed WITH a branch
  // (committed without a branch = plan-approved, not yet executed)
  const hasStarted = allTasks.some((t) =>
    EXECUTION_STATUSES.has(t.status) || (t.status === 'committed' && !!t.branch),
  );
  return hasStarted ? 'implement' : 'configure';
}
