import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { project } from '@/db/schema/projects';
import { learningCandidate } from '@/db/schema/artifacts';
import type { LearningCandidateRow } from '@/db/schema/artifacts';
import { artifact } from '@/db/schema/artifacts';
import { component, componentSection, qaMessage } from '@/db/schema/spec';
import { stage } from '@/db/schema/projects';
import type { LearningType } from '@/db/enums';
import { logAction } from '@/observability/action-log';
import { AnthropicClient } from '@/anthropic/client';
import { ComposeLearningsSchema, type ComposeLearnings } from '@/spec/schemas';
import { MmaClient } from '@/mma/client';
import { resolveWorkspaceRoot } from '@/git/workspace-root';

/**
 * Learnings curation → journal-record (Spec 4 Part B / Key flow 7) — the only
 * write path into the team journal.
 *
 * At spec-lock, `proposeLearnings` runs the orchestrator's fourth opus call
 * (`composeLearningCandidates`) over the locked spec + Q&A session to stage
 * `learning_candidate` rows. The user keeps/edits/removes them; on Save,
 * `commitLearnings` dispatches `journal-record` at `cwd`=WORKSPACE ROOT (the team
 * journal lives at `.mma/journal/`, never per-project) and stamps each kept
 * candidate `recorded` with its node id.
 *
 * SCHEMA SOURCE OF TRUTH (F28). The journal-record request body
 * (`{ learnings: string[], tagHints?: string[] }`) and the node-id extraction
 * (`structuredReport.recorded[].ids[]`) are derived from the MMA-side schema
 * (`multi-model-agent` `core/src/tools/journal/record/schema.ts` `inputSchema`
 * + `core/src/reporting/report-parser-slots/journal-report.ts`
 * `JournalStructuredReport.recorded[]`). NOTE the spec's hand-authored per-
 * candidate `{body,type}` body and `structuredReport.nodeId` field do NOT match
 * production — corrected here against the real schema.
 */

/** A candidate as surfaced to the curation UI. */
export interface LearningCandidateView {
  id: string;
  bodyMd: string;
  type: LearningType;
  status: LearningCandidateRow['status'];
  recordedNodeId: string | null;
}

function toView(row: LearningCandidateRow): LearningCandidateView {
  return {
    id: row.id,
    bodyMd: row.bodyMd,
    type: row.type as LearningType,
    status: row.status,
    recordedNodeId: row.recordedNodeId,
  };
}

export interface ProposeLearningsDeps {
  db?: Db;
  anthropic: AnthropicClient;
}

/**
 * Propose learnings for a locked project. IDEMPOTENT: if any `learning_candidate`
 * rows already exist, returns them without re-proposing (a re-load of /freeze
 * never duplicates). Otherwise runs `composeLearningCandidates` and inserts
 * `proposed`/`origin='spec'` rows.
 */
export async function proposeLearnings(
  deps: ProposeLearningsDeps,
  projectId: string,
): Promise<LearningCandidateView[]> {
  const db = deps.db ?? getDb();

  const existing = await db
    .select()
    .from(learningCandidate)
    .where(eq(learningCandidate.projectId, projectId))
    .orderBy(asc(learningCandidate.createdAt));
  if (existing.length > 0) return existing.map(toView);

  const { system, user } = await buildLearningsPrompt(db, projectId);
  const out: ComposeLearnings = await deps.anthropic.parse(ComposeLearningsSchema, {
    system,
    user,
    call: 'composeLearningCandidates',
    projectId,
  });

  if (out.candidates.length === 0) return [];

  const inserted = await db
    .insert(learningCandidate)
    .values(
      out.candidates.map((c) => ({
        projectId,
        bodyMd: c.bodyMd,
        type: c.type,
        origin: 'spec' as const,
        status: 'proposed' as const,
        createdBy: null,
      })),
    )
    .returning();
  return inserted.map(toView);
}

/** Build the `composeLearningCandidates` prompt from intent + locked spec + Q&A session. */
export async function buildLearningsPrompt(
  db: Db,
  projectId: string,
): Promise<{ system: string; user: string }> {
  const [proj] = await db
    .select({ intentMd: project.intentMd, name: project.name })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  const [spec] = await db
    .select({ bodyMd: artifact.bodyMd })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'spec')))
    .orderBy(sql`${artifact.version} desc`)
    .limit(1);

  // A compact transcript summary across the project's sections.
  const msgs = await db
    .select({ sender: qaMessage.sender, bodyMd: qaMessage.bodyMd })
    .from(qaMessage)
    .innerJoin(component, eq(qaMessage.componentId, component.id))
    .innerJoin(stage, eq(component.stageId, stage.id))
    .where(eq(stage.projectId, projectId))
    .orderBy(asc(qaMessage.createdAt));

  const transcript = msgs.map((m) => `- ${m.sender}: ${m.bodyMd}`).join('\n');

  const system = [
    "You are Forge's learnings curator. From the locking of a spec, propose the durable",
    'learnings worth recording in the team journal: what was figured out (insight), what',
    'was decided (decision), and what was hard about brainstorming it with Forge (challenge).',
    'Each learning is a self-contained markdown statement. Propose only what is durable',
    'and team-relevant — skip the trivial.',
  ].join('\n');

  const user = [
    `# Project: ${proj?.name ?? '(unknown)'}`,
    `\n## Intent\n${proj?.intentMd ?? '(none)'}`,
    `\n## Locked specification\n${spec?.bodyMd ?? '(none)'}`,
    transcript ? `\n## Q&A session\n${transcript}` : '',
  ].join('\n');

  return { system, user };
}

/** Set a candidate's curation status (keep/remove). */
export async function setLearningStatus(
  projectId: string,
  candidateId: string,
  status: 'kept' | 'removed',
  deps: { db?: Db } = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  await db
    .update(learningCandidate)
    .set({ status })
    .where(and(eq(learningCandidate.id, candidateId), eq(learningCandidate.projectId, projectId)));
}

/** Insert a member-authored candidate (status 'kept', origin 'spec'). */
export async function addLearning(
  projectId: string,
  input: { bodyMd: string; type: LearningType },
  actorId: string,
  deps: { db?: Db } = {},
): Promise<LearningCandidateView> {
  const db = deps.db ?? getDb();
  const [row] = await db
    .insert(learningCandidate)
    .values({
      projectId,
      bodyMd: input.bodyMd,
      type: input.type,
      origin: 'spec',
      status: 'kept',
      createdBy: actorId,
    })
    .returning();
  return toView(row);
}

/** Extract node ids from a journal-record terminal envelope: `output.summary.recorded[].ids[]`. */
export function parseRecordedNodeIds(envelope: unknown): string[] {
  const env = (envelope ?? {}) as Record<string, unknown>;
  const output = (env.output ?? {}) as Record<string, unknown>;
  const summary = output.summary;
  if (!summary || typeof summary !== 'object') return [];
  const recorded = (summary as Record<string, unknown>).recorded;
  if (!Array.isArray(recorded)) return [];
  const ids: string[] = [];
  for (const entry of recorded) {
    const e = (entry ?? {}) as { ids?: unknown };
    if (Array.isArray(e.ids)) {
      for (const id of e.ids) if (typeof id === 'string' && id.length > 0) ids.push(id);
    }
  }
  return ids;
}

/** Thrown when journal-record returned no node ids (retryable; candidates stay 'kept'). */
export class JournalRecordIncompleteError extends Error {
  constructor() {
    super('The journal write did not finish — try again.');
    this.name = 'JournalRecordIncompleteError';
  }
}

export interface CommitLearningsDeps {
  db?: Db;
  mma: MmaClient;
  /** Workspace root override (tests); defaults to `resolveWorkspaceRoot()`. */
  workspaceRoot?: string;
}

export interface CommitLearningsResult {
  recordedCount: number;
  nodeIds: string[];
}

/**
 * Commit the kept learnings to the team journal. Dispatches ONE `journal-record`
 * batch with all kept candidates as `learnings[]`, at `cwd`=WORKSPACE ROOT, then
 * stamps each kept candidate with a recorded node id and flips it to 'recorded'.
 *
 * On an envelope with no node ids (F4) the candidates stay 'kept' (retryable) and
 * `JournalRecordIncompleteError` is thrown — never stamp on a failed write.
 */
export async function commitLearnings(
  deps: CommitLearningsDeps,
  projectId: string,
  actorId: string,
): Promise<CommitLearningsResult> {
  const db = deps.db ?? getDb();
  const cwd = deps.workspaceRoot ?? resolveWorkspaceRoot();

  const kept = await db
    .select()
    .from(learningCandidate)
    .where(and(eq(learningCandidate.projectId, projectId), eq(learningCandidate.status, 'kept')))
    .orderBy(asc(learningCandidate.createdAt));

  if (kept.length === 0) return { recordedCount: 0, nodeIds: [] };

  const tagHints = [...new Set(kept.map((c) => c.type))];
  const envelope = await deps.mma.dispatchAndWait('journal-record', {
    cwd,
    body: { learnings: kept.map((c) => c.bodyMd), tagHints },
  });

  const nodeIds = parseRecordedNodeIds(envelope);
  if (nodeIds.length === 0) {
    // No node ids → failed write; leave candidates 'kept', retryable (F4).
    throw new JournalRecordIncompleteError();
  }

  // Stamp each kept candidate with a node id (positional; surplus ids ignored).
  await db.transaction(async (tx) => {
    for (let i = 0; i < kept.length; i += 1) {
      const nodeId = nodeIds[i] ?? nodeIds[nodeIds.length - 1];
      await tx
        .update(learningCandidate)
        .set({ recordedNodeId: nodeId, status: 'recorded' })
        .where(eq(learningCandidate.id, kept[i].id));
    }
    await logAction(
      { projectId, memberId: actorId, action: 'record_learnings', target: `project:${projectId}` },
      tx as unknown as Db,
    );
  });

  return { recordedCount: kept.length, nodeIds };
}

/** Load the curation set for the /freeze screen (all candidates, oldest-first). */
export async function loadLearnings(db: Db, projectId: string): Promise<LearningCandidateView[]> {
  const dbi = db ?? getDb();
  const rows = await dbi
    .select()
    .from(learningCandidate)
    .where(eq(learningCandidate.projectId, projectId))
    .orderBy(asc(learningCandidate.createdAt));
  return rows.map(toView);
}
