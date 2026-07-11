import { realpath, stat } from 'node:fs/promises';

interface RepoInput {
  id: string;
  name: string;
  pathOnDisk: string;
  defaultBranch: string;
}

export async function buildPlanAuthoringRequest(input: {
  repos: RepoInput[];
  specPath: string;
  specMd: string;
  outputPath: string;
}): Promise<{ prompt: string; target: { paths: string[] }; outputPath: string }> {
  if (input.repos.length === 0) {
    throw new Error('Plan authoring requires at least one linked repository.');
  }

  const allowlist = new Set(
    await Promise.all(
      input.repos.map(async (repo) => {
        const raw = repo.pathOnDisk.trim();
        if (!raw) throw new Error(`Linked repository "${repo.name}" must have a non-empty pathOnDisk.`);
        return realpath(raw);
      }),
    ),
  );

  const lines: string[] = [];
  for (const repo of input.repos) {
    const raw = repo.pathOnDisk.trim();
    if (!raw) throw new Error(`Linked repository "${repo.name}" must have a non-empty pathOnDisk.`);
    const normalized = await realpath(raw);
    if (!allowlist.has(normalized)) {
      throw new Error(`Linked repository "${repo.name}" at ${raw} is outside the linked-repository allowlist.`);
    }
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
