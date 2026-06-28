/**
 * Spec file operations — read/write individual sections from the physical
 * spec.md file. The file is the source of truth for spec content; the DB
 * stores metadata only (component status, approvals, participants).
 */

import { readSpecFileAsync, writeSpecAsync } from '@/projects/project-files';

const writeLocks = new Map<string, Promise<unknown>>();
async function withFileLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(projectId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeLocks.set(projectId, next);
  try { return await next; } finally {
    if (writeLocks.get(projectId) === next) writeLocks.delete(projectId);
  }
}

const COMPONENT_HEADING_RE = /^## .+/;
const SECTION_HEADING_RE = /^### .+/;

export interface SpecSection {
  component: string;
  heading: string;
  body: string;
  startLine: number;
  endLine: number;
}

/** Parse spec.md into sections by splitting on ### headings under ## components. */
export function parseSpecSections(specMd: string): SpecSection[] {
  const lines = specMd.split('\n');
  const sections: SpecSection[] = [];
  let currentComponent: string | undefined;
  let current: { component: string; heading: string; startLine: number; bodyLines: string[] } | null = null;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) { inCodeFence = !inCodeFence; if (current) current.bodyLines.push(lines[i]); continue; }
    if (inCodeFence) { if (current) current.bodyLines.push(lines[i]); continue; }

    if (COMPONENT_HEADING_RE.test(lines[i]) && !SECTION_HEADING_RE.test(lines[i])) {
      if (current) {
        sections.push({
          component: current.component,
          heading: current.heading,
          body: current.bodyLines.join('\n').trim(),
          startLine: current.startLine,
          endLine: i - 1,
        });
        current = null;
      }
      currentComponent = lines[i].replace(/^##\s*/, '').trim();
    } else if (SECTION_HEADING_RE.test(lines[i]) && currentComponent) {
      if (current) {
        sections.push({
          component: current.component,
          heading: current.heading,
          body: current.bodyLines.join('\n').trim(),
          startLine: current.startLine,
          endLine: i - 1,
        });
      }
      current = { component: currentComponent, heading: lines[i], startLine: i, bodyLines: [] };
    } else if (!current && currentComponent && lines[i].trim() && !lines[i].startsWith('#')) {
      // Content directly under ## with no ### — treat the ## itself as the section
      current = { component: currentComponent, heading: `### ${currentComponent}`, startLine: i, bodyLines: [lines[i]] };
    } else if (current) {
      current.bodyLines.push(lines[i]);
    }
  }
  if (current) {
    sections.push({
      component: current.component,
      heading: current.heading,
      body: current.bodyLines.join('\n').trim(),
      startLine: current.startLine,
      endLine: lines.length - 1,
    });
  }
  return sections;
}

/** Read a specific section from spec.md by matching component + section label. */
export async function readSpecSection(
  projectId: string,
  sectionLabel: string,
): Promise<{ component: string; heading: string; body: string } | null> {
  const file = await readSpecFileAsync(projectId);
  if (!file) return null;
  const sections = parseSpecSections(file.bodyMd);
  const match = sections.find((s) => {
    const label = s.heading.replace(/^###\s*/, '').trim();
    return label === sectionLabel;
  });
  return match ? { component: match.component, heading: match.heading, body: match.body } : null;
}

/** Replace a section in spec.md by matching its heading. Serialized per-project. */
export async function replaceSpecSection(
  projectId: string,
  sectionLabel: string,
  newBody: string,
): Promise<boolean> {
  return withFileLock(projectId, async () => {
    const file = await readSpecFileAsync(projectId);
    if (!file) return false;

    const lines = file.bodyMd.split('\n');
    const sections = parseSpecSections(file.bodyMd);
    const match = sections.find((s) => {
      const label = s.heading.replace(/^###\s*/, '').trim();
      return label === sectionLabel;
    });
    if (!match) return false;

    const before = lines.slice(0, match.startLine);
    const after = lines.slice(match.endLine + 1);
    const replacement = [match.heading, '', newBody.trim(), ''];

    const updated = [...before, ...replacement, ...after].join('\n');
    await writeSpecAsync(projectId, updated);
    return true;
  });
}
