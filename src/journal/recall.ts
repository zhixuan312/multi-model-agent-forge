/**
 * Recall envelope parsing + dispatch (Spec 6).
 *
 * ENVELOPE SHAPE (verified against the live MMA refiner pipeline, 2026-06-18):
 * `journal_recall` is a two-phase task — an implementer drafts the answer, then a
 * REFINER (the reviewer) verifies citations against the journal, drops bad ones,
 * adds missed nodes, and re-emits the FINAL answer in the implementer's own
 * format. MMA puts that refined answer (raw worker text, a ```json fenced block)
 * into `structuredReport.summary`. The block matches MMA's `journalRecallAnswerSchema`:
 *
 *   { "results": [ { "learning", "context", "relevance", "nodeId", "nodePath",
 *                    "category", "status" } ],
 *     "summary": "<synthesis answering the query>" }
 *
 * So we extract that JSON from `structuredReport.summary`, take `summary` as the
 * synthesis and each `results[]` entry as a finding citing exactly one `nodeId`.
 * The recall ROUTE only dispatches (→ `202 {batchId}`); the browser polls and
 * parses CLIENT-SIDE.
 */
import type { MmaClient } from '@/mma/client';
import { extractNodeIdFromCitationFile } from '@/journal/citations';
import type { PinnedFinding } from '@/journal/recall-content';

/**
 * One recalled learning (`results[]` entry) — cites exactly one node. Identical
 * to the shape persisted on a pin, so the live answer and a pinned answer share
 * one renderer and one fidelity.
 */
export type ParsedFinding = PinnedFinding;

export interface ParsedRecall {
  /** The synthesis answer (the refined `summary`), or a composed/miss fallback. */
  summary: string;
  /** Recalled learnings (`results[]`). */
  findings: ParsedFinding[];
  /** Distinct cited node ids across findings (first-seen order). */
  citationIds: string[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Pull the answer JSON object out of the worker's raw text. Prefers a fenced
 * ```json … ``` block; falls back to the outermost `{ … }` span. Returns null
 * when nothing parses.
 */
function extractAnswerObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1]);
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.trim());
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Normalize a worker `nodeId` (bare id or `nodes/000X-….md` path) to a 4-digit id. */
function normalizeNodeId(raw: string): string {
  return extractNodeIdFromCitationFile(raw) ?? raw.trim();
}

function asFinding(v: unknown): ParsedFinding | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  // v5.4 uses claim/evidence; legacy used learning/context/relevance
  const learning = str(o.learning) || str(o.claim);
  const context = str(o.context) || str(o.evidence);
  const relevance = str(o.relevance) || str(o.weight) || '';
  const nodeId = normalizeNodeId(str(o.nodeId));
  if (!learning && !nodeId) return null;
  return {
    learning,
    context,
    relevance,
    nodeId,
    category: str(o.category),
    status: str(o.status),
    weight: str(o.weight),
  };
}

/** Parse one worker's raw answer text (a ```json {results, summary}``` block). */
function parseAnswerText(raw: string): ParsedRecall {
  const answer = extractAnswerObject(raw);
  const rawResults = answer && Array.isArray(answer.results) ? answer.results : [];
  const findings = rawResults.map(asFinding).filter((f): f is ParsedFinding => f !== null);

  const citationIds: string[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (f.nodeId && !seen.has(f.nodeId)) {
      seen.add(f.nodeId);
      citationIds.push(f.nodeId);
    }
  }
  return { summary: answer ? str(answer.summary) : '', findings, citationIds };
}

/** The implementer's raw output from the `raw` block. */
function implementerRaw(env: Record<string, unknown>): string {
  const raw = (env.raw ?? {}) as Record<string, unknown>;
  return typeof raw.implementer === 'string' ? raw.implementer : '';
}

/**
 * Parse a recall terminal envelope into synthesis + findings + cited ids.
 *
 * v5.4 shape: `{ task, output: { summary: { answer, findings, criteriaCovered } }, raw }`
 *
 * Prefers the refiner (output.summary) when it produced findings. Falls back to
 * the implementer's draft (raw.implementer) when the refiner yielded nothing.
 */
export function parseRecallEnvelope(envelope: unknown): ParsedRecall {
  const env = (envelope ?? {}) as Record<string, unknown>;

  const output = (env.output ?? {}) as Record<string, unknown>;
  const outputSummary = output.summary;

  let refiner: ParsedRecall;
  if (outputSummary && typeof outputSummary === 'object' && !Array.isArray(outputSummary)) {
    const obj = outputSummary as Record<string, unknown>;
    const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
    const findings = rawFindings.map(asFinding).filter((f): f is ParsedFinding => f !== null);
    const citationIds: string[] = [];
    const seen = new Set<string>();
    for (const f of findings) {
      if (f.nodeId && !seen.has(f.nodeId)) { seen.add(f.nodeId); citationIds.push(f.nodeId); }
    }
    refiner = { summary: str(obj.answer), findings, citationIds };
  } else {
    refiner = { summary: '', findings: [], citationIds: [] };
  }

  const implementer = parseAnswerText(implementerRaw(env));

  const base =
    refiner.findings.length > 0
      ? refiner
      : implementer.findings.length > 0
        ? implementer
        : { summary: implementer.summary || refiner.summary, findings: [], citationIds: [] };

  const summary =
    base.summary ||
    (base.findings.length > 0 ? base.findings.map((f) => `- ${f.learning}`).join('\n') : '') ||
    'No relevant prior learnings.';

  return { summary, findings: base.findings, citationIds: base.citationIds };
}

/**
 * Dispatch a recall query on the team journal at the workspace root. Thin wrapper
 * over `MmaClient.journalRecall` so the route + tests share one call site (cwd is
 * ALWAYS the workspace root — never a project repo).
 */
export async function dispatchRecall(
  client: MmaClient,
  workspaceRoot: string,
  query: string,
): Promise<{ batchId: string }> {
  return client.journalRecall(workspaceRoot, { prompt: query });
}
