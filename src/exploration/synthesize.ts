import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { explorationTask } from '@/db/schema/exploration';
import { mmaBatch } from '@/db/schema/ops';
import { repo } from '@/db/schema/workspace';

/**
 * Synthesis prompt builder + gap markers. Builds the prompt for async MMA
 * dispatch (`dispatchAndRegister` → `explore-synthesize` handler). The
 * handler parses the response and writes exploration.md.
 */

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

