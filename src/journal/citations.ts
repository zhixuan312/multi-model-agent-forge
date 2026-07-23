/**
 * Citation extraction + resolution for Recall (Spec 6).
 *
 * SPEC-vs-REALITY (resolved against the LIVE rod, 2026-06-09): the `journal-recall`
 * terminal envelope does NOT match the spec's assumed investigate-report shape
 * (`results[]` of `{title, evidence: Citation[]}`). The real findings live in
 * `output.summary.findings[]`, each `{ weight, category, claim, evidence, suggestion }`
 * where `evidence` is a FREE-TEXT STRING that embeds node references as
 * `nodes/000X-….md` paths and backtick-wrapped `` `NNNN` `` id tokens (there is
 * no separate sources list). So node ids are extracted by scanning that evidence
 * text for those STRUCTURED reference forms — NEVER from a bare prose 4-digit
 * number (a year like `2026` written as plain text is never a citation).
 *
 * The matcher admits the full 4-digit range (no <1000-node cap — F17), matching
 * MMA's 4-digit frontmatter `id` format and the `/api/journal/nodes/[id]` guard.
 * Resolution happens CLIENT-SIDE in RecallView against the in-page index rows.
 */

/** One recall finding (`structuredReport.findings[]`). `evidence` is free text. */
export interface RecallFinding {
  title: string;
  evidence: string;
}

/** A row of the in-page node index used to resolve a citation id to a title. */
export interface IndexLookupRow {
  id: string;
  title: string;
  status: string;
}

/** A resolved Sources row. `title`/`status` are null-ish when the id is unknown. */
export interface SourceRow {
  id: string;
  title: string;
  status: string | null;
}

/**
 * Extract a node id from a citation `file`. Accepts a `nodes/000X-….md` path or
 * a bare `^\d{4}$` token. Returns null for anything else (so a prose year like
 * `2026` embedded in a sentence, or a source-file path, never phantom-cites).
 */
export function extractNodeIdFromCitationFile(file: string): string | null {
  const f = file.trim();
  // nodes/000X-….md (allow an optional leading ./ or backtick wrap already stripped upstream)
  const pathMatch = f.match(/(?:^|\/)nodes\/(\d{4})-/);
  if (pathMatch) return pathMatch[1]!;
  const bareMatch = f.match(/^nodes\/(\d{4})\.md$/);
  if (bareMatch) return bareMatch[1]!;
  // A bare, EXACT 4-digit id token (the whole field is the id).
  if (/^\d{4}$/.test(f)) return f;
  return null;
}

/**
 * Extract distinct node ids from a free-text evidence string, in first-seen
 * order. Recognizes ONLY structured reference forms — a `nodes/000X-….md` path
 * or a backtick-wrapped `` `NNNN` `` id token — so a bare prose 4-digit number
 * (e.g. a year `2026` written without backticks or a `nodes/` path) is NEVER a
 * citation. Admits the full 4-digit range (no <1000 cap — F17).
 */
export function extractNodeIdsFromText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  // nodes/000X-….md path references.
  for (const m of text.matchAll(/(?:^|[^\w/])nodes\/(\d{4})-/g)) push(m[1]!);
  // Backtick-wrapped id tokens: `0001` (4 digits exactly).
  for (const m of text.matchAll(/`(\d{4})`/g)) push(m[1]!);
  return out;
}

/**
 * Distinct node ids cited by one finding, in first-seen order (per-finding chip
 * set — two refs to different nodes → two ids; two to the same → one — F4).
 */
export function collectFindingCitationIds(finding: RecallFinding): string[] {
  return extractNodeIdsFromText(finding.evidence);
}

/** Resolve cited ids to Sources rows against the in-page index (dedup first). */
export function resolveCitations(ids: string[], index: IndexLookupRow[]): SourceRow[] {
  const byId = new Map(index.map((r) => [r.id, r]));
  const out: SourceRow[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    out.push(
      row
        ? { id, title: row.title, status: row.status }
        : { id, title: '(unknown node)', status: null },
    );
  }
  return out;
}
