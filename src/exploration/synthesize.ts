import { and, eq, max } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { artifact } from '@/db/schema/artifacts';
import { project } from '@/db/schema/projects';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/mma';
import { repo } from '@/db/schema/workspace';
import { AnthropicClient } from '@/anthropic/client';
import { ProjectEventBus, projectEventBus } from '@/sse/event-bus';
import { logAction } from '@/observability/action-log';
import { logPoll } from '@/observability/poll-log';
import { SynthesisSchema, composeExplorationMarkdown, type Synthesis } from '@/exploration/schemas';
import { recordOrchestratorUsage } from '@/usage/record-orchestrator';

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
  anthropic?: Pick<AnthropicClient, 'parse' | 'parseWithUsage'>;
  bus?: ProjectEventBus;
}

export interface SynthesizeResult {
  ok: boolean;
  artifactId?: string;
  version?: number;
}

const SYNTH_SYSTEM = `You are Forge's exploration synthesizer. You read the completed investigation, research, and journal recall results and produce a grounded brief that a spec author can work from in the next stage.

Write three sections:

**Context** — what problem the team is solving and why. Ground this in the original brain-dump intent, not just the task results. One paragraph.

**Findings** — what the agents actually discovered. Organize by theme, not by task. Be specific: name files, functions, patterns, libraries, and prior decisions. For each finding, note whether it came from codebase investigation, web research, or journal recall. If a task failed, state what was attempted and that findings are unavailable. Do not pad with generic knowledge — only include what the agents found.

**Recommendation** — a concrete proposed approach based on the findings. Not "consider options" — pick one approach and explain why the findings support it. Call out risks or open questions that the spec should address.

Keep it concise but specific. The spec author will use this brief as their starting point — vague summaries waste their time.`;

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

  const anthropic = deps.anthropic ?? (await AnthropicClient.fromMainTier());
  let synthesis: Synthesis;
  try {
    const result = await anthropic.parseWithUsage(SynthesisSchema, {
      system: SYNTH_SYSTEM,
      user: [
        '# Records',
        recordsBlock || '(no successful records yet)',
        '',
        '# Failed tasks (you MUST mention each verbatim in Findings)',
        failureMarkers.join('\n') || '(none)',
      ].join('\n'),
      call: 'synthesizeExploration',
      projectId,
    });
    synthesis = result.data;
    await recordOrchestratorUsage(projectId, 'synthesizeExploration', result.usage, { db }).catch(() => {});
  } catch (err) {
    // Retain the prior version; suppress synthesis.updated; log server-side.
    logPoll({ level: 'error', event: 'synthesize.failure', projectId, detail: errName(err) });
    return { ok: false };
  }

  // Deterministically guarantee every failed task's marker is present in
  // Findings (the assertable observable), regardless of model output.
  let findings = synthesis.findings;
  for (const marker of failureMarkers) {
    if (!findings.includes(marker)) {
      findings = `${findings.trim()}\n\n${marker}`;
    }
  }
  const bodyMd = composeExplorationMarkdown({ ...synthesis, findings });

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
    await tx.update(project).set({ updatedAt: new Date() }).where(eq(project.id, projectId));
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
