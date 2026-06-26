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
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n*/;

export interface ExplorationFile {
  version: number;
  updatedAt: string;
  bodyMd: string;
}

function parseFrontmatter(content: string): ExplorationFile {
  const m = content.match(FRONTMATTER_RE);
  if (m) {
    const meta = m[1];
    const versionMatch = meta.match(/^version:\s*(\d+)/m);
    const updatedMatch = meta.match(/^updated_at:\s*(.+)/m);
    return {
      version: versionMatch ? Number(versionMatch[1]) : 1,
      updatedAt: updatedMatch ? updatedMatch[1].trim() : '',
      bodyMd: content.slice(m[0].length),
    };
  }
  return { version: 1, updatedAt: '', bodyMd: content };
}

function stampFrontmatter(bodyMd: string, version: number): string {
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Singapore' }).replace('T', ' ');
  return `---\nversion: ${version}\nupdated_at: ${now}\n---\n\n${bodyMd}`;
}

/**
 * Read the exploration summary from disk (sync).
 * Returns null if the file doesn't exist.
 */
export function readExplorationSummary(projectId: string): string | null {
  const filePath = join(projectDir(projectId), EXPLORATION_FILE);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

/**
 * Read the exploration summary with version (sync).
 */
export function readExplorationFile(projectId: string): ExplorationFile | null {
  const raw = readExplorationSummary(projectId);
  if (!raw) return null;
  return parseFrontmatter(raw);
}

/**
 * Read the exploration summary from disk (async).
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
 * Read the exploration summary with version (async).
 */
export async function readExplorationFileAsync(projectId: string): Promise<ExplorationFile | null> {
  const raw = await readExplorationSummaryAsync(projectId);
  if (!raw) return null;
  return parseFrontmatter(raw);
}

/**
 * Write the exploration summary to disk with version bump.
 * Reads the current version, increments, stamps the new file.
 */
export function writeExplorationSummary(projectId: string, bodyMd: string): string {
  const dir = projectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, EXPLORATION_FILE);
  const prev = existsSync(filePath) ? parseFrontmatter(readFileSync(filePath, 'utf-8')) : null;
  const nextVersion = (prev?.version ?? 0) + 1;
  writeFileSync(filePath, stampFrontmatter(bodyMd, nextVersion), 'utf-8');
  return filePath;
}

/**
 * Write the exploration summary to disk with version bump (async).
 */
export async function writeExplorationSummaryAsync(projectId: string, bodyMd: string): Promise<string> {
  const dir = projectDir(projectId);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, EXPLORATION_FILE);
  let prevVersion = 0;
  try {
    const raw = await readFile(filePath, 'utf-8');
    prevVersion = parseFrontmatter(raw).version;
  } catch { /* file doesn't exist yet */ }
  const nextVersion = prevVersion + 1;
  await writeFile(filePath, stampFrontmatter(bodyMd, nextVersion), 'utf-8');
  return filePath;
}
