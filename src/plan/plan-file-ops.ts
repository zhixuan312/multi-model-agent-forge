/**
 * Plan file operations — read/write individual task sections from the
 * physical plan.md file. The file is the source of truth; operations
 * are surgical section replacements, never full rewrites.
 */

import { backupArtifact, readPlanFile, writePlan } from '@/projects/project-files';
import { parseMarkdownOutline, sectionTitle } from '@/lib/markdown-outline';

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

/**
 * The one section a stored task title refers to, or `null` when that is not answerable.
 *
 * Both callers pass a `details` task title, and those are produced by `sectionTitle(heading)`
 * in `plan-author.ts` — so the EXACT normalized heading is what a title means, and that is
 * what is tried first.
 *
 * The old rule was `heading.includes(taskTitle)`, first match wins. On a plan that numbers
 * its tasks the two agree, because `Task 5: …` prefixes are unique. But `TASK_HEADING_RE`
 * deliberately accepts unnumbered headings too, and there "Setup" is a substring of "Setup
 * and teardown" — so refining one task could locate the other, and `replaceTaskSection` then
 * OVERWRITES the section it located. Being approximately right is fine for a lookup and not
 * fine for a write.
 *
 * The substring fallback is kept, because a plan.md edited by hand can drift from the stored
 * title and finding the task anyway is the friendlier behaviour. What it will not do is
 * GUESS: if a substring matches more than one section, that is ambiguous and the answer is
 * no match, not the first one.
 */
export function findTaskSection(sections: PlanTaskSection[], taskTitle: string): PlanTaskSection | null {
  const exact = sections.filter((s) => sectionTitle(s.heading) === taskTitle);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null; // duplicate titles — the title identifies nothing
  const loose = sections.filter((s) => s.heading.includes(taskTitle));
  return loose.length === 1 ? loose[0]! : null;
}

/** Read a specific task section from plan.md by matching its title. */
export async function readTaskSection(
  projectId: string,
  taskTitle: string,
): Promise<{ heading: string; body: string } | null> {
  const file = await readPlanFile(projectId);
  if (!file) return null;
  const match = findTaskSection(parsePlanSections(file.bodyMd), taskTitle);
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
    const match = findTaskSection(parsePlanSections(file.bodyMd), taskTitle);
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
