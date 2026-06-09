/**
 * Review→markdown adapter (Spec 8 F25). The review result is the MMA `review`
 * batch envelope (structured JSON), NOT a stored `artifact.body_md`. The `.md`
 * and PDF paths need a markdown STRING, so this normalizes the envelope into one.
 *
 * Faithfulness scope (F19): for review there is no raw source to be byte-equal
 * to — the `.md` is faithful to THIS adapter's output. The adapter is
 * deterministic so `md-export` ↔ this output round-trip exactly.
 *
 * Strategy: prefer a markdown body the envelope already carries
 * (`report` / `reportMarkdown` / `markdown` as a string); otherwise compose a
 * `## NN.`-free markdown doc from the structured findings.
 */
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** Normalize a review batch `result` envelope to a markdown string. */
export function reviewResultToMarkdown(result: unknown): string {
  const env = asObj(result);

  // 1) A ready-made markdown body wins (some MMA envelopes carry one).
  for (const key of ['report', 'reportMarkdown', 'markdown', 'summary'] as const) {
    const v = env[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim() + '\n';
  }

  // 2) Compose from the structured report.
  const sr = asObj(env.structuredReport);
  const lines: string[] = ['# Review report', ''];

  const outcome = sr.findingsOutcome ?? sr.outcome;
  if (typeof outcome === 'string') {
    lines.push(`**Outcome:** ${titleCase(outcome.replace(/_/g, ' '))}`, '');
  }

  const findings = Array.isArray(sr.findings) ? sr.findings : [];
  if (findings.length === 0) {
    lines.push('No findings reported.', '');
  } else {
    lines.push('## Findings', '');
    findings.forEach((raw, i) => {
      const f = asObj(raw);
      const severity = typeof f.severity === 'string' ? f.severity : 'unknown';
      const title = typeof f.title === 'string' ? f.title : `Finding ${i + 1}`;
      const detail = typeof f.detail === 'string' ? f.detail : typeof f.body === 'string' ? f.body : '';
      lines.push(`### ${i + 1}. ${title} _(${severity})_`, '');
      if (detail) lines.push(detail, '');
    });
  }

  return lines.join('\n').replace(/\n+$/, '\n');
}
