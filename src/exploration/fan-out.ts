import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import {
  PROMPT_FLOORS,
  type ProposedTask,
} from '@/exploration/schemas';

/**
 * Fan-out prompt builder + validation. Builds the propose prompt for async
 * MMA dispatch (`dispatchMma` → `explore-propose` handler). The handler
 * parses the response and inserts `exploration_task` rows.
 */


const PROPOSE_SYSTEM = `Role: You are a senior technical exploration planner.

Task: Analyze the user's brain-dump brief and propose a focused set of investigation, research, and journal recall tasks that will surface the information needed to write a specification.

Context: Each task you propose spawns a real agent session — an LLM that reads a codebase, searches the web, or queries a team journal. The results feed into a synthesis brief that grounds the spec stage. Be economical — only propose tasks that surface information the spec author genuinely needs.

Constraints:
- Maximum 10 tasks total. Aim for 4–7.
- investigate (2–5 tasks): one focused codebase question per task. Combine related questions. Each MUST name exactly one target_repo_id from the provided subset.
- research (0–2 tasks): web search for external tech, libraries, or approaches. Skip for internal refactors.
- journal (1–2 tasks): recall prior team decisions. Always propose at least 1.
- Each prompt must meet its floor: investigate ≥20 chars, research ≥20 chars, journal ≥10 chars.
- Do not propose tasks for information obvious from the brief itself.

Output format: Return a JSON object with a "tasks" array. Each task has: kind, prompt, target_repo_id (required for investigate, null for others).`;

/** Build the brief + repo-subset prompt the orchestrator reads. */
function buildProposeUser(args: {
  brief: string;
  repos: { id: string; name: string | null }[];
}): string {
  const repoLines = args.repos.map((r) => `- ${r.id} (${r.name ?? 'unknown'})`).join('\n');
  return [
    '# Input: Brain-dump brief',
    '',
    args.brief || '(empty)',
    '',
    '# Input: Available repositories (use these IDs for target_repo_id)',
    '',
    repoLines || '(none)',
  ].join('\n');
}

/** Validate one proposed task's shape against the repo subset + floors. */
function classify(
  t: ProposedTask,
  repoIds: Set<string>,
): { ok: true; task: ProposedTask } | { ok: false; reason: 'kind' | 'repo' | 'sub_floor' } {
  if (t.kind !== 'investigate' && t.kind !== 'research' && t.kind !== 'journal') {
    return { ok: false, reason: 'kind' };
  }
  if (t.kind === 'investigate') {
    if (!t.targetRepoId || !repoIds.has(t.targetRepoId)) return { ok: false, reason: 'repo' };
  } else if (t.targetRepoId != null) {
    return { ok: false, reason: 'repo' }; // non-null repo on research/journal
  }
  const floor = PROMPT_FLOORS[t.kind];
  if (t.prompt.trim().length < floor) return { ok: false, reason: 'sub_floor' };
  return { ok: true, task: t };
}

export async function buildProposeRequest(
  projectId: string,
  deps: { db?: Db } = {},
): Promise<{ system: string; user: string }> {
  const db = deps.db ?? getDb();

  const { validateDetails } = await import('@/details/schema');
  const { getBriefText, getRepos } = await import('@/details/read');
  const [projRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
  const d = projRow?.details ? validateDetails(projRow.details) : null;
  const briefText = d ? getBriefText(d) : '';
  const repos = d ? getRepos(d).map((r) => ({ id: r.id, name: r.name })) : [];

  return {
    system: PROPOSE_SYSTEM,
    user: buildProposeUser({ brief: briefText, repos }),
  };
}

