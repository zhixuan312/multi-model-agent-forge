import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { resolveWorkspaceRoot } from '@/git/workspace-root';

/**
 * File-based project artifact storage. Each project gets a directory under
 * `.forge-workspace/.mma/projects/<project-id>/`. Artifacts are stored as
 * markdown files — the single source of truth for content.
 *
 * Engineers can edit these files outside Forge. As long as the markdown
 * format is correct, Forge will render them properly.
 *
 * Concurrency: writes are direct (not atomic rename). Safe for single-process
 * use. Cross-process concurrent writes may interleave.
 */

function projectDir(projectId: string): string {
  if (!/^[a-z0-9-]+$/i.test(projectId)) throw new Error(`Invalid projectId: ${projectId}`);
  const root = resolveWorkspaceRoot();
  return join(root, '.mma', 'projects', projectId);
}

/* ── Exploration summary ──────────────────────────────────────────────── */

const EXPLORATION_FILE = 'exploration.md';

/**
 * Read the exploration summary markdown from disk (sync).
 * Used in contexts where async is impractical (export collect-artifacts).
 * Returns null if the file doesn't exist yet.
 */
export function readExplorationSummary(projectId: string): string | null {
  const filePath = join(projectDir(projectId), EXPLORATION_FILE);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

/**
 * Read the exploration summary markdown from disk (async).
 * Preferred for request handlers — does not block the event loop.
 */
export async function readExplorationSummaryAsync(projectId: string): Promise<string | null> {
  try {
    const filePath = join(projectDir(projectId), EXPLORATION_FILE);
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write the exploration summary markdown to disk.
 * Creates the project directory if it doesn't exist.
 * Returns the file path.
 */
export function writeExplorationSummary(projectId: string, bodyMd: string): string {
  const dir = projectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, EXPLORATION_FILE);
  writeFileSync(filePath, bodyMd, 'utf-8');
  return filePath;
}

/**
 * Write the exploration summary markdown to disk (async).
 * Preferred for request handlers — does not block the event loop.
 */
export async function writeExplorationSummaryAsync(projectId: string, bodyMd: string): Promise<string> {
  const dir = projectDir(projectId);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, EXPLORATION_FILE);
  await writeFile(filePath, bodyMd, 'utf-8');
  return filePath;
}
