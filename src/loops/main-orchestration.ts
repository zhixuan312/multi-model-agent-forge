import { z } from 'zod';

/**
 * Main-agent (orchestrator) prompts + response parsers for the loop. Two calls
 * share one MMA `main` session: PLAN (before any work) and JOURNAL (after). Each
 * prompt uses the standardized 6-section format and demands a strict JSON object.
 */

// ── PLAN ──────────────────────────────────────────────────────────────────────

export const planSchema = z.object({
  recalls: z
    .array(z.object({ query: z.string().trim().min(1), purpose: z.string().trim().optional() }))
    .max(8)
    .default([]),
  verifyCommand: z.string().trim().min(1).nullable().default(null),
});
export type LoopPlan = z.infer<typeof planSchema>;

export const PLAN_OUTPUT_FORMAT =
  'A single JSON object: {"recalls":[{"query":string,"purpose":string}],"verifyCommand":string|null}. No prose.';

export function planPrompt(goalMd: string, repoContext?: string): string {
  const contextBlock = repoContext ? `\n\n--- Repository structure ---\n${repoContext}\n--- End structure ---` : '';
  return `Role: You are the planning brain for a scheduled Forge maintenance loop. You investigate the repository before any worker touches it and produce a run plan.

Task: Investigate the repository to understand its structure, then produce a JSON run plan with (a) journal recall queries and (b) the correct verify command.

Context: A maintenance loop is about to run a worker agent against this repository with the goal below. Before the worker starts, you need to:
1. Read the repo's build/test config files (package.json, Makefile, pyproject.toml, Cargo.toml, go.mod, etc.) to discover the REAL test/build command
2. For monorepos with subdirectories (backend/, frontend/, etc.), check EACH subdirectory for its own config
3. Check what test framework is used (vitest, jest, pytest, go test, cargo test, etc.)
4. Decide what journal queries would help the worker avoid past mistakes

Input:

--- Goal ---
${goalMd}
--- End Goal ---${contextBlock}

Constraints:
- You MUST read the repo's build/test configuration files before choosing verifyCommand — do NOT guess
- For monorepos, the verify command must cd into the right directory first (e.g. "cd backend && npm test")
- verifyCommand must be the EXACT command that validates the repo — only use commands that actually exist in the config files you read
- If no test/build system is found, set verifyCommand to null — never invent a command that doesn't exist
- recalls: 0-5 journal queries for prior learnings relevant to this goal — fewer is better, only ask for what helps

Output format:
Respond with ONLY a single JSON object — no prose, no markdown, no commentary:
{"recalls":[{"query":"<specific search>","purpose":"<why this helps>"}],"verifyCommand":"<exact command>" or null}`;
}

// ── JOURNAL ─────────────────────────────────────────────────────────────────────

export const journalSchema = z.object({
  entries: z
    .array(z.object({ tag: z.enum(['learned', 'missed', 'avoided']), text: z.string().trim().min(1) }))
    .default([]),
});
export type JournalResult = z.infer<typeof journalSchema>;

export const JOURNAL_OUTPUT_FORMAT =
  'A single JSON object: {"entries":[{"tag":"learned"|"missed"|"avoided","text":string}]}. No prose.';

export interface JournalContext {
  goalMd: string;
  workerSummary: string;
  filesChanged: string[];
  verify: { command: string | null; passed: boolean | null; detail: string };
}

export function journalPrompt(ctx: JournalContext): string {
  const verifyLine =
    ctx.verify.command === null
      ? 'not configured'
      : `\`${ctx.verify.command}\` → ${ctx.verify.passed ? 'PASS' : 'FAIL'} (${ctx.verify.detail})`;
  return `Role: You are the journal recorder for a completed Forge maintenance loop. You decide what the team should remember for future runs.

Task: Review what happened during this maintenance run and extract durable, reusable insights — things a future run should know to avoid mistakes, save time, or make better decisions.

Context: The maintenance worker just finished running against the goal below. You can see what files changed, whether verification passed, and what the worker reported. Your job is to distill what was LEARNED, not describe what was DONE.

Input:

--- Goal ---
${ctx.goalMd}
--- End Goal ---

--- What happened ---
Files changed: ${ctx.filesChanged.length ? ctx.filesChanged.join(', ') : 'none'}
Verification: ${verifyLine}
Worker summary: ${ctx.workerSummary || '(none)'}
--- End ---

Constraints:
- Only record genuinely reusable insight — NOT "task completed" or a restatement of the goal
- Frame each entry as "When [situation], [action] because [reason]" — actionable for a future run
- Tags: learned (fact/approach to reuse), missed (unresolved/blocked + why), avoided (pitfall deliberately skipped)
- If nothing is genuinely worth recording, return an empty entries array — silence is better than noise

Output format:
Respond with ONLY a single JSON object — no prose, no markdown, no commentary:
{"entries":[{"tag":"learned|missed|avoided","text":"<actionable insight>"}]}`;
}

// ── shared JSON extraction ──────────────────────────────────────────────────────

/** Pull the JSON object out of a main-agent reply (tolerates a ```json fence + surrounding prose). */
function extractJsonObject(raw: string): string | null {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

function parseWith<T>(schema: z.ZodType<T>, raw: string): T | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const parsePlan = (raw: string): LoopPlan | null => parseWith(planSchema, raw);
export const parseJournal = (raw: string): JournalResult | null => parseWith(journalSchema, raw);
