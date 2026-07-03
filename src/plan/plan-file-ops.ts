/**
 * Plan file operations — read/write individual task sections from the
 * physical plan.md file. The file is the source of truth; operations
 * are surgical section replacements, never full rewrites.
 */

import { backupArtifact, readPlanFileAsync, writePlanAsync } from '@/projects/project-files';

const writeLocks = new Map<string, Promise<unknown>>();
async function withFileLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(projectId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeLocks.set(projectId, next);
  try { return await next; } finally {
    if (writeLocks.get(projectId) === next) writeLocks.delete(projectId);
  }
}

const TASK_HEADING_RE = /^### (?:Task |[A-Z0-9]+[\s\.\:\—\-]).+/;
const PHASE_HEADING_RE = /^## .+/;

export interface PlanTaskSection {
  heading: string;
  body: string;
  phase?: string;
  startLine: number;
  endLine: number;
}

/** Parse plan.md into task sections by splitting on ### headings, with ## headings as phase markers. */
export function parsePlanSections(planMd: string): PlanTaskSection[] {
  const lines = planMd.split('\n');
  const sections: PlanTaskSection[] = [];
  let currentPhase: string | undefined;
  let current: { heading: string; phase?: string; startLine: number; bodyLines: string[] } | null = null;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) { inCodeFence = !inCodeFence; if (current) current.bodyLines.push(lines[i]); continue; }
    if (inCodeFence) { if (current) current.bodyLines.push(lines[i]); continue; }
    if (PHASE_HEADING_RE.test(lines[i]) && !TASK_HEADING_RE.test(lines[i])) {
      if (current) {
        sections.push({
          heading: current.heading,
          body: current.bodyLines.join('\n').trim(),
          phase: current.phase,
          startLine: current.startLine,
          endLine: i - 1,
        });
        current = null;
      }
      currentPhase = lines[i].replace(/^##\s*/, '').trim();
    } else if (TASK_HEADING_RE.test(lines[i])) {
      if (current) {
        sections.push({
          heading: current.heading,
          body: current.bodyLines.join('\n').trim(),
          phase: current.phase,
          startLine: current.startLine,
          endLine: i - 1,
        });
      }
      current = { heading: lines[i], phase: currentPhase, startLine: i, bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(lines[i]);
    }
  }
  if (current) {
    sections.push({
      heading: current.heading,
      body: current.bodyLines.join('\n').trim(),
      phase: current.phase,
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

/** Replace a task section in plan.md by matching its heading, writing back the file. Serialized per-project to prevent concurrent-write races. */
export async function replaceTaskSection(
  projectId: string,
  taskTitle: string,
  newBody: string,
): Promise<boolean> {
  return withFileLock(projectId, async () => {
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
    await backupArtifact(projectId, 'plan.md');
    await writePlanAsync(projectId, updated);
    return true;
  });
}
