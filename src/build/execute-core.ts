import { execFile } from 'node:child_process';
import { slugRefComponent } from '@/build/slug';

// Re-export types + inferExecutePhase for server-side consumers
export { type TaskForGrouping, type RepoGroup, type ExecutePhase, inferExecutePhase } from '@/build/execute-types';
export { groupTasksByRepo, buildForgeBranch, listRemoteBranches };

// Import types for use in this file
import type { TaskForGrouping, RepoGroup } from '@/build/execute-types';

function groupTasksByRepo(tasks: TaskForGrouping[], projectName: string, projectShortId: string): RepoGroup[] {
  const map = new Map<string, RepoGroup>();
  for (const t of tasks) {
    let group = map.get(t.targetRepoId);
    if (!group) {
      group = {
        repoId: t.targetRepoId,
        repoName: t.repoName,
        pathOnDisk: t.repoPath,
        defaultBranch: t.defaultBranch,
        branches: [t.defaultBranch],
        targetBranch: t.defaultBranch,
        tasks: [],
        forgeBranch: buildForgeBranch(projectName, projectShortId),
      };
      map.set(t.targetRepoId, group);
    }
    group.tasks.push(t);
  }
  return [...map.values()];
}

function buildForgeBranch(projectName: string, shortId: string): string {
  const slug = slugRefComponent(projectName);
  return `forge/${slug}-${shortId}`;
}

async function listRemoteBranches(repoPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoPath, 'branch', '-r', '--list', 'origin/*', '--format=%(refname:short)'], { timeout: 10_000 }, (err, stdout) => {
      if (err || !stdout.trim()) { resolve([]); return; }
      resolve(stdout.trim().split('\n').map((b) => b.replace(/^origin\//, '').trim()).filter((b) => b && b !== 'HEAD'));
    });
  });
}
