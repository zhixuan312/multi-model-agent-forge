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

/**
 * `null` means there was legitimately nothing to open — the branch carries no changes.
 * Every OTHER reason returns `{ error }` so the caller can tell the user.
 *
 * All three used to be `null`, so a team that had simply never configured a Git token saw
 * execute finish, no PR appear, and no explanation anywhere.
 */
export type BuildPrResult = { url: string } | { error: string } | null;

export async function createBuildPr(deps: BuildPrDeps, args: BuildPrArgs): Promise<BuildPrResult> {
  const hasChanges = await deps.branchHasChanges(args.repoPath, args.branch, args.targetBranch);
  if (!hasChanges) return null;

  const token = await deps.readGitToken();
  if (!token) return { error: 'No Git token is configured for this team — the branch was pushed but no PR was opened.' };

  const remote = deps.parseRemote(args.repoPath);
  if (!remote) return { error: 'The repository has no readable GitHub remote — the branch was pushed but no PR was opened.' };

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

    // GitHub answers both of the ordinary re-run outcomes with a 422, and reporting either
    // as "PR creation failed" is wrong in a way the user cannot act on.
    if (res.status === 422) {
      // The project branch is stable BY DESIGN — `buildForgeBranch` uses the project's
      // creation date precisely so retries reuse it — so the second execute run on any
      // project opens a PR for a head that already has one. That is success, not failure,
      // and the answer the caller needs is the URL of the PR that already exists.
      if (/already exists/i.test(text)) {
        const existing = await findOpenPr(deps, remote, args.branch, token);
        if (existing) return { url: existing };
      }
      // An execute run that committed nothing. `null` is exactly what this function means
      // by "there was legitimately nothing to open" — the state its own docstring
      // describes and that no caller could reach, because `branchHasChanges` is stubbed
      // `true` at the one call site. GitHub is the authority on it either way.
      if (/[Nn]o commits between/.test(text)) return null;
    }

    return { error: `GitHub PR creation failed: ${res.status} ${text}` };
  }

  const json = (await res.json()) as { html_url: string };
  return { url: json.html_url };
}

/** The open PR whose head is `branch`, if there is one. Best-effort: null on any trouble. */
async function findOpenPr(
  deps: BuildPrDeps,
  remote: { owner: string; repo: string },
  branch: string,
  token: string,
): Promise<string | null> {
  try {
    const url =
      `https://api.github.com/repos/${remote.owner}/${remote.repo}/pulls` +
      `?state=open&head=${encodeURIComponent(`${remote.owner}:${branch}`)}`;
    const res = await deps.fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ html_url?: string }>;
    return Array.isArray(list) && typeof list[0]?.html_url === 'string' ? list[0].html_url : null;
  } catch {
    return null;
  }
}
