/**
 * Deterministic filename slug + kind→noun map (Spec 8 §"Filename slug rule", F4).
 *
 * slug(s) = lowercase → NFKD normalize → replace every run of non-[a-z0-9] with a
 * single `-` → trim leading/trailing `-` → truncate to 60 chars (trim a trailing
 * `-` again after truncation). Empty result ⇒ `untitled`.
 *
 *   "My Project: v2" → "my-project-v2"
 *   "  Über/Repo  "  → "uber-repo"
 *   "…"              → "untitled"
 *
 * Per-artifact `.md` filenames use FIXED kind nouns (exploration.md,
 * specification.md, plan.md, review.md) — not the project slug. The project slug
 * is only the combined PDF (`<slug>.pdf`) + bundle zip (`<slug>.zip`).
 */
export type ExportArtifactKind = 'exploration' | 'spec' | 'plan' | 'review';

const SLUG_MAX = 60;

export function slug(input: string): string {
  let s = (input ?? '').toLowerCase();
  // NFKD normalize then drop combining marks so accented chars fold to ascii.
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9]+/g, '-'); // every run of non-[a-z0-9] → single '-'
  s = s.replace(/^-+/, '').replace(/-+$/, ''); // trim leading/trailing
  if (s.length > SLUG_MAX) {
    s = s.slice(0, SLUG_MAX).replace(/-+$/, ''); // truncate + re-trim trailing '-'
  }
  return s === '' ? 'untitled' : s;
}

/** Kind → fixed file noun (the `.md` filename stem). */
const KIND_NOUN: Record<ExportArtifactKind, string> = {
  exploration: 'exploration',
  spec: 'specification',
  plan: 'plan',
  review: 'review',
};

/** The fixed noun for a kind (e.g. `spec` → `specification`). */
export function kindNoun(kind: ExportArtifactKind): string {
  return KIND_NOUN[kind];
}

/** The per-artifact `.md` filename (fixed kind noun, never the project slug). */
export function mdFileName(kind: ExportArtifactKind): string {
  return `${KIND_NOUN[kind]}.md`;
}
