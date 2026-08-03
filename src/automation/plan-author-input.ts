import { realpath, stat } from 'node:fs/promises';

interface RepoInput {
  id: string;
  name: string;
  pathOnDisk: string;
  defaultBranch: string;
}

/**
 * Build the mma-plan request: the spec by path, plus the linked-repo list that Phase A
 * needs, with every repo path resolved and checked to be a real directory.
 *
 * It deliberately does NOT re-check containment. Repo paths are not caller-supplied —
 * `resolveCloneTarget` (src/git/workspace.ts) is the single place a repo's `pathOnDisk`
 * is minted, and it throws `PathEscapeError` unless the path is a direct child of the
 * workspace root. An "allowlist" check used to live here that was built from the same
 * `input.repos` it then validated, so it could never fail: it read as a boundary while
 * enforcing nothing.
 */
export async function buildPlanAuthoringRequest(input: {
  repos: RepoInput[];
  specPath: string;
  specMd: string;
  outputPath: string;
}): Promise<{ prompt: string; target: { paths: string[] }; outputPath: string }> {
  if (input.repos.length === 0) {
    throw new Error('Plan authoring requires at least one linked repository.');
  }

  const lines: string[] = [];
  for (const repo of input.repos) {
    const raw = repo.pathOnDisk.trim();
    if (!raw) throw new Error(`Linked repository "${repo.name}" must have a non-empty pathOnDisk.`);
    const normalized = await realpath(raw);
    const st = await stat(normalized);
    if (!st.isDirectory()) {
      throw new Error(`Linked repository "${repo.name}" at ${normalized} is not a directory.`);
    }
    lines.push(`- ${repo.name} (${normalized})`);
  }

  // The spec is passed by PATH so the worker reads the live file and can grep
  // sections during Phase A (lighter payload than embedding the whole body).
  // `target` is paths-XOR-inline, so the repo list — Phase A's other essential
  // input — rides in the prompt alongside the feature title. mma-plan (>=5.8.7)
  // requires a non-empty `prompt` under a strict schema; derive the title from
  // the spec's H1, falling back to a generic.
  const specTitle = input.specMd.match(/^#\s+(.+)$/m)?.[1]?.trim();

  return {
    prompt: [
      specTitle || 'Implementation plan',
      '',
      '# Linked repositories',
      '',
      ...lines,
    ].join('\n'),
    target: { paths: [input.specPath] },
    outputPath: input.outputPath,
  };
}
