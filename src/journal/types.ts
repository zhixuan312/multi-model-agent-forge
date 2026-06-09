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

export const isEdgeType = (v: unknown): v is EdgeType => EDGE_TYPES.includes(v as EdgeType);
export const isStatus = (v: unknown): v is JournalStatus =>
  STATUS_VALUES.includes(v as JournalStatus);
export const isLogOp = (v: unknown): v is LogOp => LOG_OPS.includes(v as LogOp);

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
  status: string; // expected ∈ STATUS_VALUES; unknown tolerated
  tags: string[]; // lowercase kebab-case
  date: string; // ISO-8601 (YYYY-MM-DD)
  links: JournalEdge[];
  supersededBy: string | null;
  context: string; // ## Context body
  consequences: string; // ## Consequences body
  /** First non-heading body line before `## Context`, if any (crux subtitle). */
  crux: string | null;
  /** The `nodes/000X-….md` filename (relative to the journal dir). */
  filename: string;
}

/** One row of `index.md` (display metadata; tags split on the comma cell). */
export interface IndexRow {
  id: string;
  date: string;
  status: string;
  title: string;
  tags: string[];
}

/** One parsed line of `log.md`. `op` is raw (unknown op renders neutral). */
export interface LogEntry {
  date: string; // ISO-8601 timestamp string, verbatim from the line
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
  date: string;
  filename: string;
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
