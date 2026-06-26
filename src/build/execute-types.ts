export interface TaskForGrouping {
  id: string;
  title: string;
  orderIndex: number;
  targetRepoId: string;
  repoName: string;
  repoPath: string;
  defaultBranch: string;
  status: string;
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

export type ExecutePhase = 'configure' | 'monitor';

export function inferExecutePhase(groups: Array<{ tasks: Array<{ status: string }> }>): ExecutePhase {
  const allTasks = groups.flatMap((g) => g.tasks);
  if (allTasks.length === 0) return 'configure';
  const hasStarted = allTasks.some((t) => t.status !== 'queued');
  if (!hasStarted) return 'configure';
  return 'monitor';
}
