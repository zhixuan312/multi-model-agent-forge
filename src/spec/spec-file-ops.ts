/**
 * Spec file operations — parse sections from the physical spec.md file.
 * The file is the source of truth for spec content; the DB stores metadata
 * only (component status, approvals, participants).
 */

import { readSpecFile } from '@/projects/project-files';

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
    } else if (SECTION_HEADING_RE.test(lines[i])) {
      if (current) {
        sections.push({
          component: current.component,
          heading: current.heading,
          body: current.bodyLines.join('\n').trim(),
          startLine: current.startLine,
          endLine: i - 1,
        });
      }
      current = { component: currentComponent ?? '', heading: lines[i], startLine: i, bodyLines: [] };
    } else if (!current && currentComponent && lines[i].trim() && !lines[i].startsWith('#')) {
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

/** Read all sections for a component from spec.md, matched by section labels. */
export async function readComponentSections(
  projectId: string,
  sectionLabels: string[],
): Promise<{ heading: string; body: string }[]> {
  const file = await readSpecFile(projectId);
  if (!file) return [];
  const sections = parseSpecSections(file.bodyMd);
  const labelSet = new Set(sectionLabels.map((l) => l.toLowerCase()));
  return sections
    .filter((s) => labelSet.has(s.heading.replace(/^###\s*/, '').trim().toLowerCase()))
    .map((s) => ({ heading: s.heading, body: s.body }));
}
