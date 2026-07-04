/**
 * Shared code-review finding helpers. A review pass is `revised` (needs a fix
 * pass) when it carries any critical/high finding, else `clean` (advance). Lenient
 * about where findings live in the envelope (`output.findings` or
 * `output.summary.findings`) and about the severity key (`severity` or `weight`).
 */
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
