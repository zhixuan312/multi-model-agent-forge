import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planFileName } from '@/build/slug';

/**
 * Per-repo plan file writer + `.forge/` git hygiene. Writes the plan markdown
 * to `<repo>/.forge/plan-<id>.md` for MMA execution, and adds `.forge/` to
 * `.git/info/exclude` so scratch files are invisible to `git status`.
 * Injectable fs seam for testability.
 */

/** Injectable fs seam (tests pass an in-memory fake or a temp-dir-backed impl). */
export interface PlanFs {
  mkdir(dir: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  appendFile(path: string, content: string): Promise<void>;
}

export const nodePlanFs: PlanFs = {
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  writeFile: async (path, content) => {
    await writeFile(path, content, 'utf8');
  },
  readFile: async (path) => readFile(path, 'utf8'),
  appendFile: async (path, content) => {
    await appendFile(path, content, 'utf8');
  },
};

/** The absolute path to a repo's plan file: `<repoPath>/.forge/plan-<id>.md`. */
export function planFilePath(repoPath: string, projectId: string): string {
  return join(repoPath, '.forge', planFileName(projectId));
}

/**
 * Write a repo's plan markdown to `<repoPath>/.forge/plan-<id>.md`. Creates the
 * `.forge/` dir. Does NOT touch git exclude (that is `ensureForgeExcluded`, run at
 * branch-prep). Returns the absolute path written.
 */
export async function writePlanFile(
  fs: PlanFs,
  repoPath: string,
  projectId: string,
  planMd: string,
): Promise<string> {
  const dir = join(repoPath, '.forge');
  await fs.mkdir(dir);
  const path = planFilePath(repoPath, projectId);
  await fs.writeFile(path, planMd);
  return path;
}

/**
 * Idempotently add `.forge/` to the repo's `.git/info/exclude` so the scratch dir
 * is invisible to `git status` and never a commit candidate (F10). Reads the
 * existing exclude file (tolerating absence) and appends only if the entry is
 * missing. Called at first branch-prep per repo.
 */
export async function ensureForgeExcluded(fs: PlanFs, repoPath: string): Promise<void> {
  const excludeDir = join(repoPath, '.git', 'info');
  const excludePath = join(excludeDir, 'exclude');
  let existing = '';
  try {
    existing = await fs.readFile(excludePath);
  } catch {
    existing = '';
  }
  const lines = existing.split('\n').map((l) => l.trim());
  if (lines.includes('.forge/') || lines.includes('.forge')) return;
  await fs.mkdir(excludeDir);
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await fs.appendFile(excludePath, `${prefix}.forge/\n`);
}
