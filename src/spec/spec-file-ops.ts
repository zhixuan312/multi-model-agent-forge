/**
 * Spec file operations — parse sections from the physical spec.md file.
 * The file is the source of truth for spec content; the DB stores metadata
 * only (component status, approvals, participants).
 */

import { readSpecFile } from '@/projects/project-files';
import { parseMarkdownOutline, sectionTitle } from '@/lib/markdown-outline';

/** Any `###` line opens a section — a spec author is not constrained in how they title one. */
const SECTION_HEADING_RE = /^### .+/;

export interface SpecSection {
  component: string;
  heading: string;
  body: string;
  startLine: number;
  endLine: number;
}

/**
 * Parse spec.md into sections by splitting on `###` headings under `##` components.
 *
 * `implicitSection` is on: a component written as one unheaded block still yields a
 * section, titled after the component.
 */
export function parseSpecSections(specMd: string): SpecSection[] {
  return parseMarkdownOutline(specMd, {
    itemHeading: SECTION_HEADING_RE,
    implicitSection: true,
  }).map(({ container, heading, body, startLine, endLine }) => ({
    component: container,
    heading,
    body,
    startLine,
    endLine,
  }));
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
    .filter((s) => labelSet.has(sectionTitle(s.heading).toLowerCase()))
    .map((s) => ({ heading: s.heading, body: s.body }));
}
