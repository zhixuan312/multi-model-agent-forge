import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { resolveWorkspaceRoot } from '@/git/workspace-root';

/**
 * File-based project artifact storage. Each project gets a directory under
 * `.forge-workspace/.mma/projects/<project-id>/`. Artifacts are stored as
 * markdown files with YAML frontmatter — the single source of truth for content.
 *
 * Files: exploration.md, spec.md (more to come as stages migrate from DB).
 */

function projectDir(projectId: string): string {
  if (!/^[a-z0-9-]+$/i.test(projectId)) throw new Error(`Invalid projectId: ${projectId}`);
  const root = resolveWorkspaceRoot();
  return join(root, '.mma', 'projects', projectId);
}

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
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Singapore' }).replace('T', ' ');
  return `---\nversion: ${version}\nupdated_at: ${now}\n---\n\n${bodyMd}`;
}

function readFileSync_(projectId: string, filename: string): string | null {
  const filePath = join(projectDir(projectId), filename);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

async function readFileAsync_(projectId: string, filename: string): Promise<string | null> {
  try {
    return await readFile(join(projectDir(projectId), filename), 'utf-8');
  } catch { return null; }
}

function readArtifact(projectId: string, filename: string): ArtifactFile | null {
  const raw = readFileSync_(projectId, filename);
  if (!raw) return null;
  return parseFrontmatter(raw);
}

async function readArtifactAsync(projectId: string, filename: string): Promise<ArtifactFile | null> {
  const raw = await readFileAsync_(projectId, filename);
  if (!raw) return null;
  return parseFrontmatter(raw);
}

function writeArtifact(projectId: string, filename: string, bodyMd: string): string {
  const dir = projectDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  const prev = existsSync(filePath) ? parseFrontmatter(readFileSync(filePath, 'utf-8')) : null;
  const nextVersion = (prev?.version ?? 0) + 1;
  writeFileSync(filePath, stampFrontmatter(bodyMd, nextVersion), 'utf-8');
  return filePath;
}

async function writeArtifactAsync(projectId: string, filename: string, bodyMd: string): Promise<{ filePath: string; version: number }> {
  const dir = projectDir(projectId);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);
  let prevVersion = 0;
  try {
    const raw = await readFile(filePath, 'utf-8');
    prevVersion = parseFrontmatter(raw).version;
  } catch { /* file doesn't exist yet */ }
  const nextVersion = prevVersion + 1;
  await writeFile(filePath, stampFrontmatter(bodyMd, nextVersion), 'utf-8');
  return { filePath, version: nextVersion };
}

/* ── Exploration ─────────────────────────────────────────────────────── */

const EXPLORATION_FILE = 'exploration.md';

export type ExplorationFile = ArtifactFile;

export function readExplorationSummary(projectId: string): string | null {
  return readFileSync_(projectId, EXPLORATION_FILE);
}

export function readExplorationFile(projectId: string): ExplorationFile | null {
  return readArtifact(projectId, EXPLORATION_FILE);
}

export async function readExplorationSummaryAsync(projectId: string): Promise<string | null> {
  return readFileAsync_(projectId, EXPLORATION_FILE);
}

export async function readExplorationFileAsync(projectId: string): Promise<ExplorationFile | null> {
  return readArtifactAsync(projectId, EXPLORATION_FILE);
}

export function writeExplorationSummary(projectId: string, bodyMd: string): string {
  return writeArtifact(projectId, EXPLORATION_FILE, bodyMd);
}

export async function writeExplorationSummaryAsync(projectId: string, bodyMd: string): Promise<string> {
  const { filePath } = await writeArtifactAsync(projectId, EXPLORATION_FILE, bodyMd);
  return filePath;
}

/* ── Spec ────────────────────────────────────────────────────────────── */

const SPEC_FILE = 'spec.md';

export type SpecFile = ArtifactFile;

export function readSpecFile(projectId: string): SpecFile | null {
  return readArtifact(projectId, SPEC_FILE);
}

export async function readSpecFileAsync(projectId: string): Promise<SpecFile | null> {
  return readArtifactAsync(projectId, SPEC_FILE);
}

export function readSpecSummary(projectId: string): string | null {
  return readFileSync_(projectId, SPEC_FILE);
}

export async function readSpecSummaryAsync(projectId: string): Promise<string | null> {
  return readFileAsync_(projectId, SPEC_FILE);
}

export async function writeSpecAsync(projectId: string, bodyMd: string): Promise<{ filePath: string; version: number }> {
  return writeArtifactAsync(projectId, SPEC_FILE, bodyMd);
}

/* ── Plan ───────────────────────────────────────────────────────────── */

const PLAN_FILE = 'plan.md';

export type PlanFile = ArtifactFile;

export function readPlanFile(projectId: string): PlanFile | null {
  return readArtifact(projectId, PLAN_FILE);
}

export async function readPlanFileAsync(projectId: string): Promise<PlanFile | null> {
  return readArtifactAsync(projectId, PLAN_FILE);
}

export async function writePlanAsync(projectId: string, bodyMd: string): Promise<{ filePath: string; version: number }> {
  return writeArtifactAsync(projectId, PLAN_FILE, bodyMd);
}
