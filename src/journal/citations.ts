/**
 * Citation extraction + resolution for Recall (Spec 6).
 *
 * SPEC-vs-REALITY (resolved against the LIVE rod, 2026-06-09): the `journal-recall`
 * terminal envelope does NOT match the spec's assumed investigate-report shape
 * (`results[]` of `{title, evidence: Citation[]}`). The real findings live in
 * `output.summary.findings[]`, each `{ weight, category, claim, evidence, suggestion }`.
 *
 * Each finding carries its cited node in a STRUCTURED `nodeId` field, so that is what
 * `recall.ts` reads — it does not scan the free-text `evidence` for references. The
 * field is not always clean, though: it arrives as a `nodes/000X-….md` path just as
 * often as a bare id, which is what `extractNodeIdFromCitationFile` normalizes.
 *
 * That normalizer admits the full 4-digit range (no <1000-node cap — F17), matching
 * MMA's 4-digit frontmatter `id` format and the `/api/journal/nodes/[id]` guard, and
 * returns null for anything else so a prose year like `2026` can never phantom-cite.
 * Resolution happens CLIENT-SIDE in RecallView against the in-page index rows.
 */

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
