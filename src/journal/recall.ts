/**
 * Recall envelope parsing + dispatch (Spec 6).
 *
 * SPEC-vs-REALITY (resolved against the LIVE rod, 2026-06-09): the spec assumed
 * `journal-recall` reuses the investigate report contract (`structuredReport.summary`
 * = synthesis, `results[]` = findings with `Citation[]`). The REAL envelope is
 * different: `structuredReport.summary` is just a count (e.g. `"18 finding(s)"`),
 * `results[]` is per-task batch metadata (cost/stages — NOT findings), and the
 * actual findings live in `structuredReport.findings[]`, each shaped
 * `{ severity, category, claim, evidence, suggestion }` where `evidence` is a
 * FREE-TEXT string embedding `nodes/000X-….md` paths + backtick id tokens.
 *
 * So the synthesis answer is COMPOSED from the findings (category · claim ·
 * evidence) and node ids are scanned out of the evidence text. The recall ROUTE
 * only dispatches (→ `202 {batchId}`); the browser polls and parses CLIENT-SIDE.
 */
import type { MmaClient } from '@/mma/client';
import {
  collectFindingCitationIds,
  extractNodeIdsFromText,
  type RecallFinding,
} from '@/journal/citations';

/** One finding with its parsed metadata (for richer rendering). */
export interface ParsedFinding extends RecallFinding {
  severity: string;
  category: string;
  claim: string;
  suggestion: string;
}

export interface ParsedRecall {
  /** The synthesis answer — the worker's summary, or a composed fallback. */
  summary: string;
  /** Findings (`structuredReport.findings[]`). */
  findings: ParsedFinding[];
  /** All distinct cited node ids across findings (first-seen order). */
  citationIds: string[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asFinding(v: unknown): ParsedFinding | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const claim = str(o.claim) || str(o.title);
  const evidence = str(o.evidence);
  if (!claim && !evidence) return null;
  return {
    title: claim,
    evidence,
    severity: str(o.severity),
    category: str(o.category),
    claim,
    suggestion: str(o.suggestion),
  };
}

/** True when the worker's summary is just a finding-count placeholder. */
function isCountSummary(s: string): boolean {
  return /^\s*\d+\s+finding\(s\)\s*$/i.test(s.trim());
}

/** Parse a recall terminal envelope into synthesis + findings + cited ids. */
export function parseRecallEnvelope(envelope: unknown): ParsedRecall {
  const env = (envelope ?? {}) as Record<string, unknown>;
  const sr = (env.structuredReport ?? {}) as Record<string, unknown>;
  const rawFindings = Array.isArray(sr.findings) ? sr.findings : [];
  const findings = rawFindings.map(asFinding).filter((f): f is ParsedFinding => f !== null);

  const allIds: string[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    for (const id of collectFindingCitationIds(f)) {
      if (!seen.has(id)) {
        seen.add(id);
        allIds.push(id);
      }
    }
  }

  // Synthesis: prefer the worker's summary when it's real prose; otherwise (a
  // bare count, or empty) compose one from the findings, or fall back to a
  // recall-miss message when there are none.
  const summaryRaw = str(sr.summary);
  let summary: string;
  if (summaryRaw && !isCountSummary(summaryRaw)) {
    summary = summaryRaw;
  } else if (findings.length > 0) {
    summary = findings.map((f) => `- ${f.claim}`).join('\n');
  } else {
    // No findings and no real summary (empty or a bare count) → recall-miss.
    summary = 'No relevant prior learnings.';
  }

  return { summary, findings, citationIds: allIds };
}

/** Per-finding cited ids (re-exported for the view's inline chip rendering). */
export { collectFindingCitationIds };

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
  return client.journalRecall(workspaceRoot, { query });
}
