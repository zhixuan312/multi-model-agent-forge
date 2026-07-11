import { realpath, stat } from 'node:fs/promises';

interface RepoInput {
  id: string;
  name: string;
  pathOnDisk: string;
  defaultBranch: string;
}

export async function buildPlanAuthoringRequest(input: {
  repos: RepoInput[];
  specMd: string;
  outputPath: string;
}): Promise<{ target: { inline: string }; outputPath: string }> {
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

  return {
    target: {
      inline: `${input.specMd}\n\n# Linked repositories\n\n${lines.join('\n')}\n\n# Output path\n\n${input.outputPath}`,
    },
    outputPath: input.outputPath,
  };
}
