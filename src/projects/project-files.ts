import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { formatTimestamp } from '@/lib/format-date';
import type { Db } from '@/db/client';
import { resolveProjectArtifactDir } from '@/projects/project-workspace';

/**
 * File-based project artifact storage. Each project's artifacts live under its
 * OWNING TEAM's workspace root — `<teamRoot>/.mma/projects/<project-id>/` — beside
 * the team journal (`<teamRoot>/.mma/journal/`), so all of a team's data sits
 * under its own root. The directory is resolved via `resolveProjectArtifactDir`
 * (project → team → workspace root), so every accessor is async and takes an
 * optional `db` (defaults to the request DB; falls back to the global root when
 * the DB is unavailable). Artifacts are markdown files with YAML frontmatter.
 *
 * Files: exploration.md, spec.md, plan.md, journal.md.
 */

/* ── Shared frontmatter ──────────────────────────────────────────────── */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n*/;

export interface ArtifactFile {
  version: number;
  updatedAt: string;
  bodyMd: string;
}

function parseFrontmatter(content: string): ArtifactFile {
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
  return `---\nversion: ${version}\nupdated_at: ${formatTimestamp(new Date())}\n---\n\n${bodyMd}`;
}

/* ── Generic artifact IO (team-scoped dir) ───────────────────────────── */

async function readRaw(projectId: string, filename: string, db?: Db): Promise<string | null> {
  try {
    return await readFile(join(await resolveProjectArtifactDir(projectId, db), filename), 'utf-8');
  } catch {
    return null;
  }
}

async function readArtifact(projectId: string, filename: string, db?: Db): Promise<ArtifactFile | null> {
  const raw = await readRaw(projectId, filename, db);
  return raw ? parseFrontmatter(raw) : null;
}

async function writeArtifact(
  projectId: string,
  filename: string,
  bodyMd: string,
  db?: Db,
): Promise<{ filePath: string; version: number }> {
  const dir = await resolveProjectArtifactDir(projectId, db);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);
  let prevVersion = 0;
  try {
    prevVersion = parseFrontmatter(await readFile(filePath, 'utf-8')).version;
  } catch {
    /* file doesn't exist yet */
  }
  const nextVersion = prevVersion + 1;
  await writeFile(filePath, stampFrontmatter(bodyMd, nextVersion), 'utf-8');
  return { filePath, version: nextVersion };
}

async function artifactFilePath(projectId: string, filename: string, db?: Db): Promise<string> {
  return join(await resolveProjectArtifactDir(projectId, db), filename);
}

/** Back up the current version of an artifact file before it changes. */
export async function backupArtifact(projectId: string, filename: string, db?: Db): Promise<void> {
  const dir = await resolveProjectArtifactDir(projectId, db);
  const filePath = join(dir, filename);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const { version } = parseFrontmatter(raw);
    const backupDir = join(dir, 'backups');
    await mkdir(backupDir, { recursive: true });
    const name = filename.replace(/\.md$/, '');
    await writeFile(join(backupDir, `${name}_v${version}.md`), raw, 'utf-8');
  } catch {
    /* file doesn't exist yet — nothing to back up */
  }
}

/* ── Exploration ─────────────────────────────────────────────────────── */

const EXPLORATION_FILE = 'exploration.md';

export type ExplorationFile = ArtifactFile;

export async function readExplorationSummary(projectId: string, db?: Db): Promise<string | null> {
  return readRaw(projectId, EXPLORATION_FILE, db);
}

export async function readExplorationFile(projectId: string, db?: Db): Promise<ExplorationFile | null> {
  return readArtifact(projectId, EXPLORATION_FILE, db);
}

export async function writeExplorationSummary(projectId: string, bodyMd: string, db?: Db): Promise<string> {
  const { filePath } = await writeArtifact(projectId, EXPLORATION_FILE, bodyMd, db);
  return filePath;
}

/* ── Spec ────────────────────────────────────────────────────────────── */

const SPEC_FILE = 'spec.md';

export type SpecFile = ArtifactFile;

export async function specFilePath(projectId: string, db?: Db): Promise<string> {
  return artifactFilePath(projectId, SPEC_FILE, db);
}

export async function readSpecFile(projectId: string, db?: Db): Promise<SpecFile | null> {
  return readArtifact(projectId, SPEC_FILE, db);
}

export async function writeSpec(projectId: string, bodyMd: string, db?: Db): Promise<{ filePath: string; version: number }> {
  return writeArtifact(projectId, SPEC_FILE, bodyMd, db);
}

/* ── Plan ───────────────────────────────────────────────────────────── */

const PLAN_FILE = 'plan.md';

export type PlanFile = ArtifactFile;

export async function planFilePath(projectId: string, db?: Db): Promise<string> {
  return artifactFilePath(projectId, PLAN_FILE, db);
}

export async function readPlanFile(projectId: string, db?: Db): Promise<PlanFile | null> {
  return readArtifact(projectId, PLAN_FILE, db);
}

export async function writePlan(projectId: string, bodyMd: string, db?: Db): Promise<{ filePath: string; version: number }> {
  return writeArtifact(projectId, PLAN_FILE, bodyMd, db);
}

/* ── Journal ─────────────────────────────────────────────────────── */

const JOURNAL_FILE = 'journal.md';

export type JournalFile = ArtifactFile;

export async function journalFilePath(projectId: string, db?: Db): Promise<string> {
  return artifactFilePath(projectId, JOURNAL_FILE, db);
}

export async function readJournalFile(projectId: string, db?: Db): Promise<JournalFile | null> {
  return readArtifact(projectId, JOURNAL_FILE, db);
}

export async function writeJournal(projectId: string, bodyMd: string, db?: Db): Promise<{ filePath: string; version: number }> {
  return writeArtifact(projectId, JOURNAL_FILE, bodyMd, db);
}
