/**
 * Shared code-review finding helpers. A review pass is `revised` (needs a fix pass) when
 * it carries any critical/high finding, else `clean` (advance).
 *
 * ONE parse, used by every consumer. The gate (`hasBlockingReviewFindings`) and the
 * display/fix path (`extractReviewFindings`) previously read the envelope by different
 * rules — different location, different severity key — so a pass could be gated on one
 * severity while the review page and the worker's fix prompt showed another. They now
 * share `extractReviewFindings`, which makes that class of drift impossible.
 *
 * The measured contract (37 real `code-review` envelopes in the batch store): findings
 * live at `output.summary.findings[]` with a `weight` key — `output.findings` and a
 * `severity` key occurred 0 times, as did a string-valued `summary`. The tolerance for
 * those shapes is kept because it is free, but it is tolerance, not the contract.
 */
import { isBlockingSeverity } from '@/lib/severity';

export interface RawReviewFinding {
  weight: string;
  category: string;
  claim: string;
  evidence: string;
  file: string;
  line: number;
  suggestion: string;
}

/**
 * Parse the ordered findings out of a code-review envelope. Shared by the review page
 * (display) and the apply_review_findings effect (subset enumeration) so a checked
 * row's index maps 1:1 to the finding the worker fixes.
 */
export function extractReviewFindings(envelope: unknown): RawReviewFinding[] {
  const env = envelope as Record<string, unknown> | null;
  const output = (env?.output ?? {}) as Record<string, unknown>;
  let summary: unknown = output.summary;
  if (typeof summary === 'string') {
    try { summary = JSON.parse(summary.replace(/^```json\n?/, '').replace(/\n?```\s*$/, '')); } catch { summary = {}; }
  }
  const summaryObj = (summary && typeof summary === 'object' ? summary : {}) as Record<string, unknown>;
  const findings = Array.isArray(summaryObj.findings) ? summaryObj.findings as Array<Record<string, unknown>> : [];
  return findings.map((f) => ({
    // `severity` is accepted as an alias so the one parse is at least as lenient as the
    // two it replaced; every observed envelope uses `weight`.
    weight: (f.weight as string) ?? (f.severity as string) ?? 'medium',
    category: (f.category as string) ?? '',
    claim: (f.claim as string) ?? '',
    evidence: (f.evidence as string) ?? '',
    file: (f.file as string) ?? '',
    line: typeof f.line === 'number' ? f.line : 0,
    suggestion: (f.suggestion as string) ?? '',
  }));
}

/** Enumerate the chosen review findings into a targeted fix prompt for the worker. */
export function buildReviewFixPrompt(findings: RawReviewFinding[]): string {
  const items = findings.map((f, i) => {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '(no file given)';
    const fix = f.suggestion ? `\n   Suggested fix: ${f.suggestion}` : '';
    return `${i + 1}. [${f.weight || 'medium'}] ${loc} — ${f.claim}${fix}`;
  }).join('\n');
  return `Apply the following code-review findings to the code in this repository. Make the fixes directly — edit only what these findings call for.\n\n${items}`;
}

export function hasBlockingReviewFindings(envelope: unknown): boolean {
  return extractReviewFindings(envelope).some((f) => isBlockingSeverity(f.weight));
}
