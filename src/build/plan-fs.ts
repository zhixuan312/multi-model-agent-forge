import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planFileName } from '@/build/slug';

/**
 * Plan-file-on-disk writer + `.forge/` git hygiene (Spec 7 §Plan authoring,
 * Resolved decisions §2; F10/F12).
 *
 * The plan markdown is written to `<repo.path_on_disk>/.forge/plan-<id>.md` (under
 * the cwd so `extractPlanSection`'s realpath/sandbox check passes), and `.forge/`
 * is added to the repo's `.git/info/exclude` so the scratch file never appears in
 * a teammate's `git status` and is never a commit candidate.
 *
 * The fs surface is injected so tests use temp dirs / a fake; a write failure
 * propagates so the orchestrator halts BEFORE any dispatch (F12).
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
