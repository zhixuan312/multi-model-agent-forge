import { and, eq, max } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { repo } from '@/db/schema/workspace';
import { AnthropicClient } from '@/anthropic/client';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';
import { logAction } from '@/observability/action-log';
import { logPoll } from '@/observability/poll-log';
import { SynthesisSchema, composeExplorationMarkdown, type Synthesis } from '@/exploration/schemas';

/**
 * Synthesize the exploration records into `artifact(kind='exploration')` (Spec 5
 * flow E). A main-agent (Anthropic) call reads the aggregate of terminal records
 * (their structuredReport/headline/findings) and writes the three sections
 * Background · Current state · Rough direction. Re-synthesis bumps
 * `artifact.version` and emits `synthesis.updated`.
 *
 * A FAILED task is folded as an explicit gap marker in Current state naming the
 * failed task's route (+ repo for investigate). A synthesis call FAILURE retains
 * the prior version, suppresses `synthesis.updated`, and logs server-side.
 */

export interface SynthesizeDeps {
  db?: Db;
  anthropic?: Pick<AnthropicClient, 'parse'>;
  bus?: ProjectEventBus;
}

export interface SynthesizeResult {
  ok: boolean;
  artifactId?: string;
  version?: number;
}

const SYNTH_SYSTEM = [
  'You are Forge\'s exploration synthesizer. Read the aggregate of completed task',
  'records and write three concise sections: Background (what this work is about),',
  'Current state (what exists today, grounded in the investigate/research/journal',
  'findings), and Rough direction (where to go next). Be specific and cite findings.',
].join(' ');

/** Build the gap marker for one failed task. */
export function gapMarker(route: 'investigate' | 'research' | 'journal_recall', repoName: string | null): string {
  const label = route === 'journal_recall' ? 'journal-recall' : route;
  const repoPart = route === 'investigate' && repoName ? ` · repo \`${repoName}\`` : '';
  return `(${label}${repoPart}: failed — findings unavailable)`;
}

export async function synthesize(
  projectId: string,
  actor: { id: string } | null,
  deps: SynthesizeDeps = {},
): Promise<SynthesizeResult> {
  const db = deps.db ?? getDb();
  const bus = deps.bus ?? projectEventBus;

  // Gather terminal records joined to their tasks (+ repo names for markers).
  const rows = await db
    .select({
      taskId: explorationTask.id,
      kind: explorationTask.kind,
      prompt: explorationTask.prompt,
      route: mmaBatch.route,
      batchStatus: mmaBatch.status,
      result: mmaBatch.result,
      repoName: repo.name,
    })
    .from(explorationTask)
    .innerJoin(mmaBatch, eq(explorationTask.mmaBatchId, mmaBatch.id))
    .leftJoin(repo, eq(explorationTask.targetRepoId, repo.id))
    .where(and(eq(explorationTask.projectId, projectId), eq(explorationTask.status, 'recorded')));

  if (rows.length === 0) return { ok: false };

  const successes = rows.filter((r) => r.batchStatus === 'done');
  const failures = rows.filter((r) => r.batchStatus === 'failed');

  const recordsBlock = successes
    .map((r) => {
      const env = (r.result ?? {}) as { headline?: string; structuredReport?: unknown };
      return `## ${r.route} — ${r.prompt}\n${env.headline ?? ''}\n${JSON.stringify(env.structuredReport ?? {})}`;
    })
    .join('\n\n');

  const failureMarkers = failures.map((r) => gapMarker(r.route as 'investigate' | 'research' | 'journal_recall', r.repoName));

  const anthropic = deps.anthropic ?? (await AnthropicClient.fromMainTier({ db }));
  let synthesis: Synthesis;
  try {
    synthesis = await anthropic.parse(SynthesisSchema, {
      system: SYNTH_SYSTEM,
      user: [
        '# Records',
        recordsBlock || '(no successful records yet)',
        '',
        '# Failed tasks (you MUST mention each verbatim in Current state)',
        failureMarkers.join('\n') || '(none)',
      ].join('\n'),
      call: 'synthesizeExploration',
      projectId,
    });
  } catch (err) {
    // Retain the prior version; suppress synthesis.updated; log server-side.
    logPoll({ level: 'error', event: 'synthesize.failure', projectId, detail: errName(err) });
    return { ok: false };
  }

  // Deterministically guarantee every failed task's marker is present in
  // Current state (the assertable observable), regardless of model output.
  let currentState = synthesis.currentState;
  for (const marker of failureMarkers) {
    if (!currentState.includes(marker)) {
      currentState = `${currentState.trim()}\n\n${marker}`;
    }
  }
  const bodyMd = composeExplorationMarkdown({ ...synthesis, currentState });

  // Bump version = max+1 for kind='exploration'.
  const [{ v } = { v: null }] = await db
    .select({ v: max(artifact.version) })
    .from(artifact)
    .where(and(eq(artifact.projectId, projectId), eq(artifact.kind, 'exploration')));
  const nextVersion = (v ?? 0) + 1;

  const artifactId = await db.transaction(async (tx) => {
    const [a] = await tx
      .insert(artifact)
      .values({ projectId, kind: 'exploration', bodyMd, version: nextVersion, createdBy: actor?.id ?? null })
      .returning({ id: artifact.id });
    if (actor) {
      await logAction(
        {
          projectId,
          memberId: actor.id,
          action: 'explore_synthesize',
          target: `artifact:${a.id}`,
          meta: { version: nextVersion },
        },
        tx as unknown as Db,
      );
    }
    return a.id;
  });

  bus.publish(projectId, { type: 'synthesis.updated', artifactId, version: nextVersion });
  return { ok: true, artifactId, version: nextVersion };
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}
