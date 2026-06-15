import { z } from 'zod';

/**
 * Main-agent (orchestrator) prompts + response parsers for the loop. Two calls
 * share one MMA `main` session: PLAN (before any work) and JOURNAL (after). Each
 * prompt demands a single strict JSON object and is paired with an `outputFormat`
 * string, so the answer extracts deterministically; parsing tolerates a stray
 * code fence and falls back to `null` on anything malformed.
 */

const RESPOND_JSON_ONLY = 'Respond with ONLY a single JSON object — no prose, no markdown, no commentary before or after:';

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

export function planPrompt(goalMd: string): string {
  return [
    'You are the orchestrator for a scheduled maintenance loop running against this repository.',
    'Plan the run before any work begins. You may inspect the repository to inform your plan.',
    '',
    '## Goal',
    goalMd,
    '',
    '## Decide',
    '1. recalls — team-journal lookups to run first (prior attempts, known pitfalls, past decisions). 0 to 5 items; fewer is better. Each is { "query": what to search for, "purpose": one short phrase }.',
    '2. verifyCommand — the single shell command that best checks this repo after changes (e.g. "npm test", "pnpm build"). Use null if no suitable check exists.',
    '',
    RESPOND_JSON_ONLY,
    '{"recalls":[{"query":"<text>","purpose":"<text>"}],"verifyCommand":"<command>" or null}',
  ].join('\n');
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
      : `${ctx.verify.command} → ${ctx.verify.passed ? 'PASS' : 'FAIL'} (${ctx.verify.detail})`;
  return [
    'The maintenance run you planned is complete. Decide what — if anything — is worth recording in the team journal for future runs.',
    '',
    '## Goal',
    ctx.goalMd,
    '',
    '## What happened',
    `Files changed: ${ctx.filesChanged.length ? ctx.filesChanged.join(', ') : 'none'}`,
    `Verification: ${verifyLine}`,
    `Worker summary: ${ctx.workerSummary || '(none)'}`,
    '',
    '## Record',
    'Capture durable, reusable insight only — NOT "done", NOT a restatement of the goal. Tags:',
    '- learned: a fact or approach worth reusing next run',
    '- missed: something left unresolved or blocked (and why)',
    '- avoided: a pitfall deliberately not taken',
    'If nothing is genuinely worth recording, return an empty entries list.',
    '',
    RESPOND_JSON_ONLY,
    '{"entries":[{"tag":"learned|missed|avoided","text":"<insight>"}]}',
  ].join('\n');
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
