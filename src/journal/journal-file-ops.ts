/**
 * Journal file operations — read/write individual learning sections from
 * the physical journal.md file. Mirrors plan-file-ops.ts pattern.
 */

import { backupArtifact, readJournalFile, writeJournal } from '@/projects/project-files';

const writeLocks = new Map<string, Promise<unknown>>();
async function withFileLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(projectId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeLocks.set(projectId, next);
  try { return await next; } finally {
    if (writeLocks.get(projectId) === next) writeLocks.delete(projectId);
  }
}

const LEARNING_HEADING_RE = /^### .+/;
const CATEGORY_HEADING_RE = /^## .+/;

export interface JournalSection {
  heading: string;
  body: string;
  category?: string;
  startLine: number;
  endLine: number;
}

export function parseJournalSections(journalMd: string): JournalSection[] {
  const lines = journalMd.split('\n');
  const sections: JournalSection[] = [];
  let currentCategory: string | undefined;
  let current: { heading: string; category?: string; startLine: number; bodyLines: string[] } | null = null;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) { inCodeFence = !inCodeFence; if (current) current.bodyLines.push(lines[i]); continue; }
    if (inCodeFence) { if (current) current.bodyLines.push(lines[i]); continue; }
    if (CATEGORY_HEADING_RE.test(lines[i]) && !LEARNING_HEADING_RE.test(lines[i])) {
      if (current) {
        sections.push({ heading: current.heading, body: current.bodyLines.join('\n').trim(), category: current.category, startLine: current.startLine, endLine: i - 1 });
        current = null;
      }
      currentCategory = lines[i].replace(/^##\s*/, '').trim();
    } else if (LEARNING_HEADING_RE.test(lines[i])) {
      if (current) {
        sections.push({ heading: current.heading, body: current.bodyLines.join('\n').trim(), category: current.category, startLine: current.startLine, endLine: i - 1 });
      }
      current = { heading: lines[i], category: currentCategory, startLine: i, bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(lines[i]);
    }
  }
  if (current) {
    sections.push({ heading: current.heading, body: current.bodyLines.join('\n').trim(), category: current.category, startLine: current.startLine, endLine: lines.length - 1 });
  }
  return sections;
}

export async function replaceJournalSection(
  projectId: string,
  sectionLabel: string,
  newBody: string,
): Promise<boolean> {
  return withFileLock(projectId, async () => {
    const file = await readJournalFile(projectId);
    if (!file) return false;
    const lines = file.bodyMd.split('\n');
    const sections = parseJournalSections(file.bodyMd);
    const match = sections.find((s) => s.heading.replace(/^###\s*/, '').trim() === sectionLabel);
    if (!match) return false;
    const before = lines.slice(0, match.startLine);
    const after = lines.slice(match.endLine + 1);
    const replacement = [match.heading, '', newBody.trim(), ''];
    const updated = [...before, ...replacement, ...after].join('\n');
    await backupArtifact(projectId, 'journal.md');
    await writeJournal(projectId, updated);
    return true;
  });
}
