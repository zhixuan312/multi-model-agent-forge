/**
 * Shared code-review finding helpers. A review pass is `revised` (needs a fix
 * pass) when it carries any critical/high finding, else `clean` (advance). Lenient
 * about where findings live in the envelope (`output.findings` or
 * `output.summary.findings`) and about the severity key (`severity` or `weight`).
 */
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
    weight: (f.weight as string) ?? 'medium',
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
  const env = envelope as Record<string, unknown>;
  const output = (env?.output ?? {}) as Record<string, unknown>;
  const lists: unknown[] = [];
  if (Array.isArray(output.findings)) lists.push(...output.findings);
  const summary = output.summary as Record<string, unknown> | undefined;
  if (summary && Array.isArray(summary.findings)) lists.push(...summary.findings);
  return lists.some((f) => {
    const sev = String((f as Record<string, unknown>)?.severity ?? (f as Record<string, unknown>)?.weight ?? '').toLowerCase();
    return sev === 'critical' || sev === 'high';
  });
}
