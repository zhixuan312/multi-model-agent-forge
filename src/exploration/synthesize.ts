import { eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { mmaBatch } from '@/db/schema/ops';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { validateDetails } from '@/details/schema';

/**
 * Synthesis prompt builder + gap markers. Builds the prompt for async MMA
 * dispatch (`dispatchMma` → `explore-synthesize` handler). The
 * handler parses the response and writes exploration.md.
 */

const SYNTH_SYSTEM = `Role: You are a senior technical analyst writing an exploration brief that will be read by three audiences: business unit officers, product managers, and software engineers.

Task: Read the completed investigation, research, and journal recall results below and produce a structured brief that all three audiences can understand and act on.

Context: Multiple agents have independently investigated the codebase, researched external approaches, and recalled prior team decisions. Their raw outputs are provided as input. Your job is to consolidate, cross-reference, and synthesize — not summarize each task individually.

Constraints:
- Write in plain language that a non-technical reader can follow — explain the "what" and "why" before the "how"
- Use technical terms (file names, function names, library names, config keys) only where precision requires it — always in inline code spans so they stand out as proper nouns, not jargon
- Organize by theme, not by task — cross-reference findings from different tasks
- Ground every claim in a specific finding from the input — cite files and prior decisions for traceability
- If a task failed, state what was attempted and that findings are unavailable
- Be specific and actionable — vague summaries waste everyone's time
- Pick ONE concrete approach in the direction section, not "consider options"
- Explain trade-offs in business terms (risk, effort, timeline) not just technical terms

Output format: Return a JSON object with exactly three string fields — no markdown wrapper, no code fence, just the raw JSON object:

{
  "background": "One paragraph — what problem the team is solving and why, written so a business stakeholder understands the motivation without needing to read code.",
  "currentState": "Multiple paragraphs organized by theme — what the agents discovered about the current system. Lead each theme with a plain-language summary sentence, then support with specific technical references (file names in code spans, prior decisions by node number). Use markdown formatting (bold, code spans, bullet lists).",
  "roughDirection": "One concrete proposed approach. Start with what changes from the user/business perspective, then explain the technical path. Call out risks, open questions, and dependencies the spec should address."
}

All three fields are REQUIRED and must be non-empty strings. Use markdown formatting within each field value. Do NOT put all content into background — distribute it across the three fields.`;

/** Build the gap marker for one failed task. */
export function gapMarker(route: 'investigate' | 'research' | 'journal_recall', repoName: string | null): string {
  const label = route === 'journal_recall' ? 'journal-recall' : route;
  const repoPart = route === 'investigate' && repoName ? ` · repo \`${repoName}\`` : '';
  return `(${label}${repoPart}: failed — findings unavailable)`;
}

/** Load recorded task results and build the prompt parts. Shared by both paths. */
async function loadRecordsAndBuildPrompt(db: Db, projectId: string): Promise<{ system: string; user: string; failureMarkers: string[] } | null> {
  let rows: Array<{ taskId: string; kind: string; prompt: string; route: string | null; batchStatus: string | null; result: unknown; repoName: string | null }>;

  {
    const [pRow] = await db.select({ details: project.details }).from(project).where(eq(project.id, projectId)).limit(1);
    if (!pRow?.details) return null;
    const d = validateDetails(pRow.details);
    const tasks = d.stages.exploration.phases.discover.tasks.filter((t) => t.status === 'recorded');
    if (tasks.length === 0) return null;
    const batchIds = tasks.flatMap((t) => t.attempts.map((a) => a.batchId)).filter(Boolean);
    const batches = batchIds.length > 0
      ? await db.select({ id: mmaBatch.id, route: mmaBatch.route, status: mmaBatch.status, result: mmaBatch.result })
          .from(mmaBatch).where(inArray(mmaBatch.id, batchIds))
      : [];
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const repoIds = tasks.map((t) => t.repoId).filter(Boolean) as string[];
    const repos = repoIds.length > 0
      ? await db.select({ id: repo.id, name: repo.name }).from(repo).where(inArray(repo.id, repoIds))
      : [];
    const repoMap = new Map(repos.map((r) => [r.id, r.name]));

    rows = tasks.map((t) => {
      const lastAttempt = t.attempts[t.attempts.length - 1];
      const batch = lastAttempt ? batchMap.get(lastAttempt.batchId) : undefined;
      return {
        taskId: `discover-${tasks.indexOf(t)}`,
        kind: t.kind,
        prompt: t.prompt,
        route: batch?.route ?? t.kind,
        batchStatus: batch?.status ?? null,
        result: batch?.result ?? null,
        repoName: t.repoId ? repoMap.get(t.repoId) ?? null : null,
      };
    });
  }

  if (rows.length === 0) return null;

  const hasOutput = (r: typeof rows[number]) => {
    const env = (r.result ?? {}) as Record<string, unknown>;
    const output = (env.output ?? {}) as Record<string, unknown>;
    const summary = output.summary;
    return summary && (typeof summary === 'string' ? summary.length > 0 : true);
  };
  const successes = rows.filter((r) => hasOutput(r));
  const failures = rows.filter((r) => !hasOutput(r));

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

