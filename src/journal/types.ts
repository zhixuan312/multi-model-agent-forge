/**
 * Journal types (Spec 6). A small, fixed-enum contract COPIED from MMA's
 * `packages/core/src/journal/types.ts` — never imported (mma-core is never linked
 * into Forge, technical.md §4). A test asserts this local copy equals a
 * checked-in fixture of MMA's source enum sets (drift guard); store DATA that
 * uses a value outside these sets is tolerated by the renderer (neutral chip),
 * which is a separate concern from this definition.
 */

/** Forward edge types MMA writes in node `links[].type`. */
export const EDGE_TYPES = [
  'supersedes',
  'refines',
  'relates',
  'depends-on',
  'contradicts',
  'parent',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/** Node lifecycle statuses MMA writes in frontmatter `status`. */
export const STATUS_VALUES = ['adopted', 'dropped', 'inconclusive', 'superseded'] as const;
export type JournalStatus = (typeof STATUS_VALUES)[number];

/** Write-log operation vocabulary (MMA `journal/default-schema.ts`). */
export const LOG_OPS = ['create', 'refine', 'supersede', 'merge'] as const;
export type LogOp = (typeof LOG_OPS)[number];

export const isStatus = (v: unknown): v is JournalStatus =>
  STATUS_VALUES.includes(v as JournalStatus);

/** One outgoing typed edge (frontmatter `links[]`). `type` is kept as the raw
 *  string so an unknown forward type renders neutral rather than throwing. */
export interface JournalEdge {
  type: string;
  target: string;
}

/** A fully-parsed node (frontmatter + body). `status`/edge `type` are raw
 *  strings — leniency lives in the renderer, not the type. */
export interface JournalNode {
  id: string; // zero-padded 4-digit
  title: string;
  /**
   * NOT PARSED TODAY, though every real node has one. MMA writes `topic:` on 108/108
   * nodes in the parent store (`multi-model-agent`, `multi-model-agent-forge`, …) and it
   * is the journal's primary organising dimension in multi-repo mode — Forge's viewer
   * drops it, so nodes cannot be shown or filtered by the repo they belong to. Surfacing
   * it is a UI decision, recorded rather than assumed. */
  status: string; // expected ∈ STATUS_VALUES; unknown tolerated
  tags: string[]; // lowercase kebab-case
  timestamp: string; // ISO-8601 (OKF), e.g. 2026-05-24T00:00:00Z
  links: JournalEdge[];
  supersededBy: string | null;
  context: string; // ## Context body
  consequences: string; // ## Consequences body
  /** First non-heading body line before `## Context`, if any (crux subtitle). */
  crux: string | null;
  /** The `nodes/000X-….md` filename (relative to the journal dir). */
  filename: string;
  /**
   * Lifecycle stage the node came from. OPTIONAL and frequently absent: the seed journal
   * writes it (Exploration/Spec/Plan/Execute/Review/Journal/Manual) and the 3D graph card
   * renders it, but MMA writes no `source` key — 0 of 108 nodes in the parent store carry
   * one. Absent is the normal case, not a parse failure.
   */
  source?: string;
  /** OKF node type — decision | design | behavior | process | knowledge | style.
   *  (This is MMA's OKF-required `type`; it is the same taxonomy Forge's harvest
   *  layer calls `category` — a different, separate concept, see LEARNING_CATEGORIES.) */
  type?: string;
  /** OKF-recommended one-line summary of the node (frontmatter `description`). */
  description?: string;
}

/** One row of `index.md` (OKF columns: id | timestamp | type | status | title | tags). */
export interface IndexRow {
  id: string;
  timestamp: string;
  type: string;
  status: string;
  title: string;
  tags: string[];
}

/** One parsed line of `log.md`. `op` is raw (unknown op renders neutral). */
export interface LogEntry {
  timestamp: string; // ISO-8601 timestamp string, verbatim from the line
  op: string;
  id: string;
  title: string;
}

/** A node that exists in `nodes/` but could not be parsed into a JournalNode. */
export interface NodeParseError {
  id: string | null; // best-effort id from the filename
  filename: string;
  reason: string;
}

/** A node summary shipped to the client index (frontmatter display fields only;
 *  `links` is NOT shipped — inbound is computed server-side). */
export interface NodeSummary {
  id: string;
  title: string;
  status: string;
  tags: string[];
  timestamp: string;
  filename: string;
  source?: string;
  type?: string;
  description?: string;
  /** true when listed in `index.md` but the `nodes/` file is gone. */
  fileMissing?: boolean;
}

/** An inbound edge, computed server-side by inverting another node's outgoing
 *  link (or its `supersededBy`). */
export interface InboundEdge {
  /** The inverse label (e.g. `superseded-by`, `child`, `relates`). */
  label: string;
  /** The id of the node that points AT the requested node. */
  source: string;
}

/** Result of reading the whole journal at first paint (no node bodies). */
export interface JournalReadResult {
  kind: 'ok';
  nodes: NodeSummary[];
  log: LogEntry[];
  /** Count of `nodes/*.md` that could not be parsed (surfaced as a notice). */
  skippedCount: number;
}

/** Distinct non-ok read outcomes the page renders as states (never a 500). */
export type JournalReadOutcome =
  | JournalReadResult
  | { kind: 'empty' } // no dir / nothing in it
  | { kind: 'unreadable' } // EACCES — present but unreadable
  | { kind: 'unconfigured' }; // workspace root missing / not configured

// The LEARN group's `category` taxonomy used to be declared here. It is
// `project_journal.type`'s value set, so it lives in `db/enums.ts` with the other column
// vocabularies — which is also the only file the single-source ratchet reads, and the
// column was quietly spelling the six values out again for exactly that reason.
