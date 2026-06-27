/**
 * Plan file operations — read/write individual task sections from the
 * physical plan.md file. The file is the source of truth; operations
 * are surgical section replacements, never full rewrites.
 */

import { readPlanFileAsync, writePlanAsync } from '@/projects/project-files';

const TASK_HEADING_RE = /^### .+/;

export interface PlanTaskSection {
  heading: string;
  body: string;
  startLine: number;
  endLine: number;
}

/** Parse plan.md into task sections by splitting on ### headings. */
export function parsePlanSections(planMd: string): PlanTaskSection[] {
  const lines = planMd.split('\n');
  const sections: PlanTaskSection[] = [];
  let current: { heading: string; startLine: number; bodyLines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (TASK_HEADING_RE.test(lines[i])) {
      if (current) {
        sections.push({
          heading: current.heading,
          body: current.bodyLines.join('\n').trim(),
          startLine: current.startLine,
          endLine: i - 1,
        });
      }
      current = { heading: lines[i], startLine: i, bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(lines[i]);
    }
  }
  if (current) {
    sections.push({
      heading: current.heading,
      body: current.bodyLines.join('\n').trim(),
      startLine: current.startLine,
      endLine: lines.length - 1,
    });
  }
  return sections;
}

/** Read a specific task section from plan.md by matching its title. */
export async function readTaskSection(
  projectId: string,
  taskTitle: string,
): Promise<{ heading: string; body: string } | null> {
  const file = await readPlanFileAsync(projectId);
  if (!file) return null;
  const sections = parsePlanSections(file.bodyMd);
  const match = sections.find((s) => s.heading.includes(taskTitle));
  return match ? { heading: match.heading, body: match.body } : null;
}

/** Replace a task section in plan.md by matching its heading, writing back the file. */
export async function replaceTaskSection(
  projectId: string,
  taskTitle: string,
  newBody: string,
): Promise<boolean> {
  const file = await readPlanFileAsync(projectId);
  if (!file) return false;

  const lines = file.bodyMd.split('\n');
  const sections = parsePlanSections(file.bodyMd);
  const match = sections.find((s) => s.heading.includes(taskTitle));
  if (!match) return false;

  const before = lines.slice(0, match.startLine);
  const after = lines.slice(match.endLine + 1);
  const replacement = [match.heading, '', newBody.trim(), ''];

  const updated = [...before, ...replacement, ...after].join('\n');
  await writePlanAsync(projectId, updated);
  return true;
}
