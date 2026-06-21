export interface BuildPrDeps {
  readGitToken: () => Promise<string | null>;
  parseRemote: (repoPath: string) => { owner: string; repo: string } | null;
  branchHasChanges: (repoPath: string, branch: string, target: string) => Promise<boolean>;
  fetch: typeof globalThis.fetch;
}

export interface BuildPrArgs {
  projectName: string;
  branch: string;
  targetBranch: string;
  repoPath: string;
  tasks: Array<{ title: string; commitSha: string | null }>;
}

export type BuildPrResult = { url: string } | { error: string } | null;

export async function createBuildPr(deps: BuildPrDeps, args: BuildPrArgs): Promise<BuildPrResult> {
  const hasChanges = await deps.branchHasChanges(args.repoPath, args.branch, args.targetBranch);
  if (!hasChanges) return null;

  const token = await deps.readGitToken();
  if (!token) return null;

  const remote = deps.parseRemote(args.repoPath);
  if (!remote) return null;

  const title = args.tasks.length <= 1
    ? `build(${args.projectName}): ${args.tasks[0]?.title ?? 'execute plan'}`
    : `build(${args.projectName}): ${args.tasks[0]!.title} + ${args.tasks.length - 1} more`;

  const body = args.tasks
    .map((t) => `- [x] ${t.title}${t.commitSha ? ` (${t.commitSha.slice(0, 7)})` : ''}`)
    .join('\n');

  const res = await deps.fetch(`https://api.github.com/repos/${remote.owner}/${remote.repo}/pulls`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ title, head: args.branch, base: args.targetBranch, body }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `GitHub PR creation failed: ${res.status} ${text}` };
  }

  const json = (await res.json()) as { html_url: string };
  return { url: json.html_url };
}
