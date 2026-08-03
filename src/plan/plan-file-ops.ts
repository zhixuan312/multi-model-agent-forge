/**
 * Plan file operations — read/write individual task sections from the
 * physical plan.md file. The file is the source of truth; operations
 * are surgical section replacements, never full rewrites.
 */

import { backupArtifact, readPlanFile, writePlan } from '@/projects/project-files';
import { parseMarkdownOutline } from '@/lib/markdown-outline';

const writeLocks = new Map<string, Promise<unknown>>();
async function withFileLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(projectId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeLocks.set(projectId, next);
  try { return await next; } finally {
    if (writeLocks.get(projectId) === next) writeLocks.delete(projectId);
  }
}

/**
 * A task heading, not just any `###`. Plan bodies contain their own `###` subheadings
 * (`### Notes`), and treating those as tasks would split one task into several.
 */
const TASK_HEADING_RE = /^### (?:Task |[A-Z0-9]+[\s\.\:\—\-]).+/;

export interface PlanTaskSection {
  heading: string;
  body: string;
  phase?: string;
  startLine: number;
  endLine: number;
}

/** Parse plan.md into task sections by splitting on ### headings, with ## headings as phase markers. */
export function parsePlanSections(planMd: string): PlanTaskSection[] {
  return parseMarkdownOutline(planMd, { itemHeading: TASK_HEADING_RE }).map(
    ({ container, heading, body, startLine, endLine }) => ({
      heading,
      body,
      // No `##` seen yet leaves the task unphased, which is `undefined`, not `''`.
      phase: container || undefined,
      startLine,
      endLine,
    }),
  );
}

/** Read a specific task section from plan.md by matching its title. */
export async function readTaskSection(
  projectId: string,
  taskTitle: string,
): Promise<{ heading: string; body: string } | null> {
  const file = await readPlanFile(projectId);
  if (!file) return null;
  const sections = parsePlanSections(file.bodyMd);
  const match = sections.find((s) => s.heading.includes(taskTitle));
  return match ? { heading: match.heading, body: match.body } : null;
}

/** Replace a task section in plan.md by matching its heading, writing back the file. Serialized per-project to prevent concurrent-write races. */
export async function replaceTaskSection(
  projectId: string,
  taskTitle: string,
  newBody: string,
): Promise<boolean> {
  return withFileLock(projectId, async () => {
    const file = await readPlanFile(projectId);
    if (!file) return false;

    const lines = file.bodyMd.split('\n');
    const sections = parsePlanSections(file.bodyMd);
    const match = sections.find((s) => s.heading.includes(taskTitle));
    if (!match) return false;

    const before = lines.slice(0, match.startLine);
    const after = lines.slice(match.endLine + 1);
    const replacement = [match.heading, '', newBody.trim(), ''];

    const updated = [...before, ...replacement, ...after].join('\n');
    await backupArtifact(projectId, 'plan.md');
    await writePlan(projectId, updated);
    return true;
  });
}
