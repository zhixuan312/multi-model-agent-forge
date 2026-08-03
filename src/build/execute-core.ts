import { execFile } from 'node:child_process';
import { slugRefComponent } from '@/build/slug';
import { formatIsoDate } from '@/lib/format-date';

export { groupTasksByRepo, buildForgeBranch, listRemoteBranches };

// This module used to also re-export `execute-types`' four members "for server-side
// consumers". No production code imported them from here — only a test did — so the
// re-export was a second path to one definition, which the project rules forbid. Import
// them from `@/build/execute-types` directly.
import type { TaskForGrouping, RepoGroup } from '@/build/execute-types';

function groupTasksByRepo(tasks: TaskForGrouping[], projectName: string, projectCreatedAt: Date): RepoGroup[] {
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
        forgeBranch: buildForgeBranch(projectName, projectCreatedAt),
      };
      map.set(t.targetRepoId, group);
    }
    group.tasks.push(t);
  }
  return [...map.values()];
}

/**
 * The project branch: `mma/<YYYY-MM-DD>-<project-slug>`.
 *
 * One `mma/` namespace across every caller — this, `/mma:flow`, and Forge loops — so a branch
 * name says what produced it without a per-caller prefix to remember.
 *
 * The date is the project's CREATION date, deliberately, not today's: `startExecuteRun` reuses
 * an existing project branch across retries, so a date that moved would fork a new branch on
 * every attempt and strand the earlier work.
 *
 * There is no trailing short id any more. It existed only to disambiguate same-named projects,
 * and `createProject` now rejects a name whose slug collides within the team — which is the
 * stronger check, since two DIFFERENT names ("My Project" / "My/Project") slugify identically
 * and would have collided regardless of case-insensitive name uniqueness.
 *
 * The date is rendered in Asia/Singapore, the product's one timezone, so the branch reads the
 * same day the UI shows for that project. UTC would disagree for projects created between
 * 00:00 and 08:00 SGT — a third of every day naming its branch with yesterday's date.
 */
function buildForgeBranch(projectName: string, createdAt: Date): string {
  const slug = slugRefComponent(projectName);
  return `mma/${formatIsoDate(createdAt)}-${slug}`;
}

async function listRemoteBranches(repoPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('git', ['-C', repoPath, 'branch', '-r', '--list', 'origin/*', '--format=%(refname:short)'], { timeout: 10_000 }, (err, stdout) => {
      if (err || !stdout.trim()) { resolve([]); return; }
      resolve(stdout.trim().split('\n').map((b) => b.replace(/^origin\//, '').trim()).filter((b) => b && b !== 'HEAD'));
    });
  });
}
