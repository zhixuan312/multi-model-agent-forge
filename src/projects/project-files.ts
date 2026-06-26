import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveWorkspaceRoot } from '@/git/workspace-root';

/**
 * File-based project artifact storage. Each project gets a directory under
 * `.forge-workspace/.mma/projects/<project-id>/`. Artifacts are stored as
 * markdown files — the single source of truth for content.
 *
 * Engineers can edit these files outside Forge. As long as the markdown
 * format is correct, Forge will render them properly.
 */

function projectDir(projectId: string): string {
  const root = resolveWorkspaceRoot();
  return join(root, '.mma', 'projects', projectId);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/* ── Exploration summary ──────────────────────────────────────────────── */

const EXPLORATION_FILE = 'exploration.md';

/**
 * Read the exploration summary markdown from disk.
 * Returns null if the file doesn't exist yet.
 */
export function readExplorationSummary(projectId: string): string | null {
  const filePath = join(projectDir(projectId), EXPLORATION_FILE);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

/**
 * Write the exploration summary markdown to disk.
 * Creates the project directory if it doesn't exist.
 * Returns the file path.
 */
export function writeExplorationSummary(projectId: string, bodyMd: string): string {
  const dir = projectDir(projectId);
  ensureDir(dir);
  const filePath = join(dir, EXPLORATION_FILE);
  writeFileSync(filePath, bodyMd, 'utf-8');
  return filePath;
}

/**
 * Parse an exploration summary markdown into its 3 sections.
 * Handles files written by Forge or edited externally — as long as the
 * ## Background / ## Current state / ## Rough direction headings exist.
 */
export function parseExplorationSummary(md: string): {
  background: string;
  currentState: string;
  roughDirection: string;
} {
  const sections: Record<string, string> = {};
  let currentSection = '';

  for (const line of md.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      currentSection = heading[1].trim().toLowerCase();
    } else if (currentSection) {
      const key = currentSection.replace(/\s+/g, '_');
      sections[key] = (sections[key] ?? '') + line + '\n';
    }
  }

  return {
    background: (sections['background'] ?? '').trim(),
    currentState: (sections['current_state'] ?? '').trim(),
    roughDirection: (sections['rough_direction'] ?? '').trim(),
  };
}
