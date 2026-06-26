import { and, desc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { project, projectRepo } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { attachment } from '@/db/schema/exploration';
import { explorationTask } from '@/db/schema/exploration';
import { AnthropicClient } from '@/anthropic/client';
import { logAction } from '@/observability/action-log';
import { logPoll } from '@/observability/poll-log';
import {
  ProposalSchema,
  RepairedTaskSchema,
  PROMPT_FLOORS,
  type Proposal,
  type ProposedTask,
} from '@/exploration/schemas';
import type { ExplorationTaskKind } from '@/db/enums';
import { recordOrchestratorUsage } from '@/usage/record-orchestrator';

/**
 * Brain-dump → editable fan-out proposal (Spec 5 flow B). A main-agent
 * (Anthropic) call reads the latest `exploration_brief` + attachment labels/urls
 * + the project's repo subset and proposes a grouped task plan. The structured
 * output is Zod-parsed, then each per-task validation failure has ONE defined
 * deterministic outcome (drop / one-re-ask-then-drop). The surviving conformant
 * set is inserted atomically as `exploration_task` rows (`status='draft'`).
 *
 * A failed / wholly-unparseable orchestrator response inserts ZERO rows.
 */

export interface FanOutDeps {
  db?: Db;
  /** Injectable for tests — a MOCK AnthropicClient. */
  anthropic?: Pick<AnthropicClient, 'parse' | 'parseWithUsage'>;
}

export interface FanOutResult {
  inserted: { id: string; kind: ExplorationTaskKind; prompt: string; targetRepoId: string | null }[];
  /** True iff the orchestrator response failed / was wholly unparseable (zero rows). */
  failed: boolean;
}

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

/** Build the brief + attachments + repo-subset prompt the orchestrator reads. */
function buildProposeUser(args: {
  brief: string;
  attachments: { kind: string; label: string; payload: unknown }[];
  repos: { id: string; name: string | null }[];
}): string {
  const repoLines = args.repos.map((r) => `- ${r.id} (${r.name ?? 'unknown'})`).join('\n');
  const attLines = args.attachments
    .map((a) => `- [${a.kind}] ${a.label}${urlOf(a.payload) ? ` <${urlOf(a.payload)}>` : ''}`)
    .join('\n');
  return [
    '# Input: Brain-dump brief',
    '',
    args.brief || '(empty)',
    '',
    '# Input: Attachments',
    '',
    attLines || '(none)',
    '',
    '# Input: Available repositories (use these IDs for target_repo_id)',
    '',
    repoLines || '(none)',
  ].join('\n');
}

function urlOf(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'url' in payload) {
    const u = (payload as { url?: unknown }).url;
    return typeof u === 'string' ? u : null;
  }
  return null;
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

  const [brief] = await db
    .select({ bodyMd: artifact.bodyMd })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration_brief')))
    .orderBy(desc(artifact.version))
    .limit(1);

  const attachments = await db
    .select({ kind: attachment.kind, label: attachment.label, payload: attachment.payload })
    .from(attachment)
    .where(eq(attachment.projectId, projectId));

  const repos = await db
    .select({ id: projectRepo.repoId, name: repo.name })
    .from(projectRepo)
    .leftJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, projectId));

  return {
    system: PROPOSE_SYSTEM,
    user: buildProposeUser({ brief: brief?.bodyMd ?? '', attachments, repos: repos.map((r) => ({ id: r.id, name: r.name })) }),
  };
}

export async function proposeFanOut(
  projectId: string,
  actor: { id: string },
  deps: FanOutDeps = {},
): Promise<FanOutResult> {
  const db = deps.db ?? getDb();
  const anthropic = deps.anthropic ?? (await AnthropicClient.fromMainTier());

  // Latest exploration_brief + attachments + repo subset.
  const [brief] = await db
    .select({ bodyMd: artifact.bodyMd })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration_brief')))
    .orderBy(desc(artifact.version))
    .limit(1);

  const attachments = await db
    .select({ kind: attachment.kind, label: attachment.label, payload: attachment.payload })
    .from(attachment)
    .where(eq(attachment.projectId, projectId));

  const repos = await db
    .select({ id: projectRepo.repoId, name: repo.name })
    .from(projectRepo)
    .leftJoin(repo, eq(projectRepo.repoId, repo.id))
    .where(eq(projectRepo.projectId, projectId));
  const repoIds = new Set(repos.map((r) => r.id));

  // The orchestrator call. A failure / wholly-unparseable output → zero rows.
  let proposal: Proposal;
  try {
    const result = await anthropic.parseWithUsage(ProposalSchema, {
      system: PROPOSE_SYSTEM,
      user: buildProposeUser({
        brief: brief?.bodyMd ?? '',
        attachments,
        repos: repos.map((r) => ({ id: r.id, name: r.name })),
      }),
      call: 'proposeFanOut',
      projectId,
    });
    proposal = result.data;
    await recordOrchestratorUsage(projectId, 'proposeFanOut', result.usage, { db }).catch(() => {});
  } catch (err) {
    logPoll({ level: 'error', event: 'propose.failure', projectId, detail: errName(err) });
    return { inserted: [], failed: true };
  }

  // Per-task validation: drop invalid kind/repo; one constrained re-ask for a
  // sub-floor prompt, then drop if still sub-floor.
  const conformant: ProposedTask[] = [];
  for (const t of proposal.tasks) {
    const verdict = classify(t, repoIds);
    if (verdict.ok) {
      conformant.push(verdict.task);
      continue;
    }
    if (verdict.reason !== 'sub_floor') continue; // drop kind/repo failures outright

    // Exactly ONE bounded re-ask for the offending task.
    try {
      const repaired = await anthropic.parse(RepairedTaskSchema, {
        system: PROPOSE_SYSTEM,
        user: `Rewrite this ${t.kind} task prompt so it is at least ${PROMPT_FLOORS[t.kind]} characters and well-grounded. Original: ${t.prompt}`,
        call: 'proposeFanOut.repair',
        projectId,
      });
      const re = { ...t, prompt: repaired.prompt };
      const v2 = classify(re, repoIds);
      if (v2.ok) conformant.push(v2.task);
      // else: drop (no second re-ask, no boilerplate auto-pad)
    } catch {
      // Re-ask failed → drop the single task (not the whole batch).
    }
  }

  if (conformant.length === 0) {
    return { inserted: [], failed: false }; // parseable but empty fan-out
  }

  // Atomic: clear stale drafts → insert the new set → log.
  const inserted = await db.transaction(async (tx) => {
    await tx
      .delete(explorationTask)
      .where(and(eq(explorationTask.projectId, projectId), eq(explorationTask.status, 'draft')));
    const rows = await tx
      .insert(explorationTask)
      .values(
        conformant.map((t) => ({
          projectId,
          kind: t.kind,
          targetRepoId: t.kind === 'investigate' ? t.targetRepoId! : null,
          prompt: t.prompt.trim(),
          status: 'draft' as const,
          createdBy: actor.id,
        })),
      )
      .returning({
        id: explorationTask.id,
        kind: explorationTask.kind,
        prompt: explorationTask.prompt,
        targetRepoId: explorationTask.targetRepoId,
      });
    await tx.update(project).set({ updatedAt: new Date() }).where(eq(project.id, projectId));
    await logAction(
      {
        projectId,
        memberId: actor.id,
        action: 'explore_analyze',
        target: `project:${projectId}`,
        meta: { taskCount: rows.length },
      },
      tx as unknown as Db,
    );
    return rows;
  });

  return { inserted, failed: false };
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}
