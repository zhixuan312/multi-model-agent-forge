import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
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
import { writeExplorationSummaryAsync } from '@/projects/project-files';

/**
 * Synthesize exploration records into `exploration.md` on disk. Reads
 * terminal task results (output.summary), calls Anthropic to produce
 * Background / Current state / Rough direction, and writes the file.
 *
 * Failed tasks are folded as gap markers in Current state. A synthesis
 * failure retains the prior file and logs server-side.
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

const SYNTH_SYSTEM = `Role: You are a senior technical analyst synthesizing exploration findings into a grounded brief.

Task: Read the completed investigation, research, and journal recall results below and produce a structured brief that a spec author can work from in the next stage.

Context: Multiple agents have independently investigated the codebase, researched external approaches, and recalled prior team decisions. Their raw outputs are provided as input. Your job is to consolidate, cross-reference, and synthesize — not summarize each task individually.

Constraints:
- Ground every claim in a specific finding from the input — name files, functions, patterns, libraries, line numbers, and prior decisions
- Organize by theme, not by task — cross-reference findings from different tasks
- If a task failed, state what was attempted and that findings are unavailable
- Do not pad with generic knowledge — only include what the agents actually found
- Be specific and actionable — vague summaries waste the spec author's time
- Pick ONE concrete approach in the direction section, not "consider options"

Output format: Return three sections in this exact structure:

**background**: One paragraph — what problem the team is solving and why. Ground in the original intent.

**currentState**: Multiple paragraphs organized by theme — what the agents discovered. Name specific files, functions, schemas, dependencies, patterns. Note the source (investigation/research/journal) for each finding.

**roughDirection**: One concrete proposed approach supported by the findings. Call out risks, open questions, and dependencies the spec should address.`;

/** Build the gap marker for one failed task. */
export function gapMarker(route: 'investigate' | 'research' | 'journal_recall', repoName: string | null): string {
  const label = route === 'journal_recall' ? 'journal-recall' : route;
  const repoPart = route === 'investigate' && repoName ? ` · repo \`${repoName}\`` : '';
  return `(${label}${repoPart}: failed — findings unavailable)`;
}

/** Load recorded task results and build the prompt parts. Shared by both paths. */
async function loadRecordsAndBuildPrompt(db: Db, projectId: string): Promise<{ system: string; user: string; failureMarkers: string[] } | null> {
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

  if (rows.length === 0) return null;

  const successes = rows.filter((r) => r.batchStatus === 'done');
  const failures = rows.filter((r) => r.batchStatus === 'failed');

  const recordsBlock = successes
    .map((r) => {
      const env = (r.result ?? {}) as Record<string, unknown>;
      const output = (env.output ?? {}) as Record<string, unknown>;
      const summary = output.summary;
      let answerText = '';
      if (typeof summary === 'string') {
        answerText = summary;
      } else if (summary && typeof summary === 'object') {
        const s = summary as Record<string, unknown>;
        answerText = typeof s.answer === 'string' ? s.answer
          : typeof s.summary === 'string' ? s.summary
          : JSON.stringify(s, null, 2);
      }
      const kindLabel = r.route === 'investigate' ? 'Investigation' : r.route === 'research' ? 'Research' : 'Journal recall';
      const repoTag = r.repoName ? ` (repo: ${r.repoName})` : '';
      return `### ${kindLabel}${repoTag}\n**Question:** ${r.prompt}\n**Findings:**\n${answerText}`;
    })
    .join('\n\n---\n\n');

  const failureMarkers = failures.map((r) => gapMarker(r.route as 'investigate' | 'research' | 'journal_recall', r.repoName));

  return {
    system: SYNTH_SYSTEM,
    user: [
      '# Input: Exploration task results',
      '',
      `${successes.length} tasks completed, ${failures.length} failed.`,
      '',
      recordsBlock || '(no successful records)',
      '',
      failures.length > 0 ? `# Failed tasks (mention each gap in Current state)\n${failureMarkers.join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    failureMarkers,
  };
}

export async function buildSynthesizeRequest(
  projectId: string,
  deps: { db?: Db } = {},
): Promise<{ system: string; user: string } | { error: string }> {
  const result = await loadRecordsAndBuildPrompt(deps.db ?? getDb(), projectId);
  if (!result) return { error: 'No recorded tasks to synthesize.' };
  return { system: result.system, user: result.user };
}

export async function synthesize(
  projectId: string,
  actor: { id: string } | null,
  deps: SynthesizeDeps = {},
): Promise<SynthesizeResult> {
  const db = deps.db ?? getDb();
  const bus = deps.bus ?? projectEventBus;

  const prompt = await loadRecordsAndBuildPrompt(db, projectId);
  if (!prompt) return { ok: false };

  const anthropic = deps.anthropic ?? (await AnthropicClient.fromMainTier());
  let synthesis: Synthesis;
  try {
    const result = await anthropic.parseWithUsage(SynthesisSchema, {
      system: prompt.system,
      user: prompt.user,
      call: 'synthesizeExploration',
      projectId,
    });
    synthesis = result.data;
    await recordOrchestratorUsage(projectId, 'synthesizeExploration', result.usage, { db }).catch(() => {});
  } catch (err) {
    logPoll({ level: 'error', event: 'synthesize.failure', projectId, detail: errName(err) });
    return { ok: false };
  }

  let currentState = synthesis.currentState;
  for (const marker of prompt.failureMarkers) {
    if (!currentState.includes(marker)) {
      currentState = `${currentState.trim()}\n\n${marker}`;
    }
  }
  const bodyMd = composeExplorationMarkdown({ ...synthesis, currentState });

  const filePath = await writeExplorationSummaryAsync(projectId, bodyMd);

  await db.update(project).set({ updatedAt: new Date() }).where(eq(project.id, projectId));
  if (actor) {
    await logAction({ projectId, memberId: actor.id, action: 'explore_synthesize', target: `file:${filePath}` }, db);
  }

  bus.publish(projectId, { type: 'synthesis.updated', artifactId: projectId, version: 1 });
  return { ok: true, artifactId: projectId, version: 1 };
}

function errName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return 'Error';
}
