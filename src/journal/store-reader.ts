/**
 * Server-side reader for MMA's journal store under the workspace root
 * (`<root>/.mma/journal/{index.md, nodes/*.md, log.md}`).
 *
 * EVERY filesystem access is path-sandboxed to the journal dir (realpath +
 * prefix assert; rejects `..` and symlink escapes) and only the three known
 * sources are read. Node bodies are treated as untrusted DATA — never executed.
 *
 * The store's on-disk formats are MMA's, hard-coded here (Forge COPIES rather
 * than links mma-core). The parser is intentionally lenient: it accepts the
 * real-store variations (quoted/unquoted scalars, block-sequence OR inline-flow
 * `tags`, `target:` OR `to:` link keys) and NEVER throws on bad data — an
 * unparseable node yields a parse-error marker, and a recognized node carrying
 * an unknown enum value is preserved as-is for the renderer to neutralize.
 *
 * Graceful outcomes (never a 500): missing dir → `empty`; present-but-unreadable
 * dir (EACCES) → `unreadable`.
 */
import { realpathSync, promises as fsp } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type {
  IndexRow,
  LogEntry,
  JournalNode,
  NodeParseError,
  NodeSummary,
  InboundEdge,
  JournalReadOutcome,
  EdgeType,
} from '@/journal/types';
import { EDGE_TYPES } from '@/journal/types';
import { USE_MOCK } from '@/mock/config';
import * as journalMock from '@/mock/domains/journal';

/** `<root>/.mma/journal`. */
export function journalDirFor(root: string): string {
  return join(root, '.mma', 'journal');
}

/**
 * Assert `target` resolves to a path inside `journalDir`. Resolves symlinks via
 * realpath on whichever of (target, its parent) exists, then prefix-checks.
 * Throws on any escape. The reader calls this before every read.
 */
export function assertInsideJournalDir(journalDir: string, target: string): void {
  let realRoot: string;
  try {
    realRoot = realpathSync(journalDir);
  } catch (e) {
    // A permission failure on the dir itself is a real I/O error — surface it so
    // the readers render the EACCES diagnostic rather than a confinement throw.
    if ((e as NodeJS.ErrnoException)?.code === 'EACCES') throw e;
    // Journal dir itself doesn't resolve (ENOENT) — fall back to the lexical path
    // so the prefix check still rejects `..` escapes (readers handle ENOENT).
    realRoot = resolve(journalDir);
  }
  const lexical = resolve(target);
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'EACCES') throw e;
    // Target (e.g. a node file) may not exist yet — use the lexical path, which
    // still catches a symlinked DIRECTORY escape while allowing a missing leaf.
    real = lexical;
  }
  const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (real !== realRoot && !real.startsWith(prefix)) {
    throw new Error('journal path escapes the journal directory');
  }
}

// ── Frontmatter / body parsing ──────────────────────────────────────────────

export type ParseNodeResult =
  | { ok: true; node: JournalNode }
  | { ok: false; error: NodeParseError };

/** Strip wrapping single/double quotes from a YAML scalar. */
function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Best-effort id from a `000X-title.md` filename. */
function idFromFilename(filename: string): string | null {
  const m = filename.match(/^(\d{4})-/);
  return m ? m[1]! : null;
}

/**
 * Parse a node markdown file into a JournalNode or a parse-error marker.
 * Lenient by design (never throws). Unparseable ⟺ no YAML frontmatter, or the
 * body has NEITHER `## Context` nor `## Consequences`.
 */
export function parseFrontmatter(raw: string, filename: string): ParseNodeResult {
  const fail = (reason: string): ParseNodeResult => ({
    ok: false,
    error: { id: idFromFilename(filename), filename, reason },
  });

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return fail('missing YAML frontmatter');
  const fmText = fmMatch[1]!;
  const body = fmMatch[2] ?? '';

  const fm = parseFrontmatterBlock(fmText);
  const id = fm.scalars.id ? unquote(fm.scalars.id) : idFromFilename(filename);
  if (!id) return fail('missing id');

  const hasContext = /^##\s+context\b/im.test(body);
  const hasConsequences = /^##\s+consequences\b/im.test(body);
  if (!hasContext && !hasConsequences) {
    return fail('missing both ## Context and ## Consequences sections');
  }

  const node: JournalNode = {
    id,
    title: fm.scalars.title ? unquote(fm.scalars.title) : '',
    status: fm.scalars.status ? unquote(fm.scalars.status) : '',
    tags: fm.tags,
    date: fm.scalars.date ? unquote(fm.scalars.date) : '',
    links: fm.links,
    supersededBy:
      fm.scalars.supersededBy && unquote(fm.scalars.supersededBy) !== 'null'
        ? unquote(fm.scalars.supersededBy)
        : null,
    context: extractSection(body, 'Context'),
    consequences: extractSection(body, 'Consequences'),
    crux: extractCrux(body),
    filename,
  };
  return { ok: true, node };
}

interface FrontmatterBlock {
  scalars: Record<string, string>;
  tags: string[];
  links: { type: string; target: string }[];
}

/** Parse the YAML frontmatter region for the keys the journal uses. Handles
 *  block-sequence + inline-flow `tags`, block-sequence `links` ({type, target|to}),
 *  and top-level scalars. Not a general YAML parser — scoped to this schema. */
function parseFrontmatterBlock(text: string): FrontmatterBlock {
  const lines = text.split('\n');
  const scalars: Record<string, string> = {};
  const tags: string[] = [];
  const links: { type: string; target: string }[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    const kv = trimmed.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1]!;
    const rest = kv[2]!;

    if (key === 'tags') {
      if (rest && rest.startsWith('[')) {
        // inline flow: [a, b, c]
        const inner = rest.replace(/^\[/, '').replace(/\]\s*$/, '');
        for (const t of inner.split(',')) {
          const v = unquote(t).trim();
          if (v) tags.push(v);
        }
        i++;
        continue;
      }
      // block sequence: subsequent `- value` lines (more-indented)
      i++;
      while (i < lines.length && /^\s*-\s+/.test(lines[i]!)) {
        const v = unquote(lines[i]!.replace(/^\s*-\s+/, '')).trim();
        if (v) tags.push(v);
        i++;
      }
      continue;
    }

    if (key === 'links') {
      if (rest && (rest === '[]' || rest.startsWith('['))) {
        i++;
        continue; // empty / inline-flow links (store uses block form; ignore body)
      }
      i++;
      // block sequence of mappings: `- type: x` then `  target: y` (or `to:`)
      let cur: { type?: string; target?: string } | null = null;
      while (i < lines.length) {
        const l = lines[i]!;
        const item = l.match(/^\s*-\s+(\w+):\s*(.*)$/);
        const cont = l.match(/^\s+(\w+):\s*(.*)$/);
        if (item) {
          if (cur && cur.type && cur.target) links.push({ type: cur.type, target: cur.target });
          cur = {};
          const k = item[1]!;
          const v = unquote(item[2]!);
          if (k === 'type') cur.type = v;
          else if (k === 'target' || k === 'to') cur.target = v;
          i++;
        } else if (cont) {
          if (!cur) cur = {};
          const k = cont[1]!;
          const v = unquote(cont[2]!);
          if (k === 'type') cur.type = v;
          else if (k === 'target' || k === 'to') cur.target = v;
          i++;
        } else {
          break;
        }
      }
      if (cur && cur.type && cur.target) links.push({ type: cur.type, target: cur.target });
      continue;
    }

    // plain scalar
    scalars[key] = rest;
    i++;
  }

  return { scalars, tags, links };
}

/** Extract the prose under a `## <name>` heading up to the next `## ` heading. */
function extractSection(body: string, name: string): string {
  const re = new RegExp(`^##\\s+${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'im');
  const m = body.match(re);
  return m ? m[1]!.trim() : '';
}

/**
 * The crux line: the first NON-EMPTY, NON-HEADING body line that appears BEFORE
 * the first `## ` heading. If the body leads straight into a heading, null.
 */
export function extractCrux(body: string): string | null {
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) return null; // hit a heading first → no crux
    return line;
  }
  return null;
}

// ── index.md / log.md line parsing ──────────────────────────────────────────

/** Parse one `index.md` table row; null for header/separator/blank. */
export function parseIndexRow(line: string): IndexRow | null {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const cells = t.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 5) return null;
  if (cells[0] === 'id') return null; // header
  if (/^-+$/.test(cells[0]!)) return null; // separator
  const [id, date, status, title, tagsCell] = cells;
  if (!/^\d{4}$/.test(id!)) return null;
  const tags = (tagsCell ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { id: id!, date: date!, status: status!, title: title!, tags };
}

/** Parse one `log.md` line: `<ISO-8601>  <op>  <id>  <title>`. */
export function parseLogLine(line: string): LogEntry | null {
  const t = line.trim();
  if (!t) return null;
  // Fields are whitespace-delimited (2+ spaces in the store); split on runs of
  // whitespace, keeping the title (which may contain single spaces) intact.
  const m = t.match(/^(\S+)\s+(\S+)\s+(\d{4})\s+(.+)$/);
  if (!m) return null;
  return { date: m[1]!, op: m[2]!, id: m[3]!, title: m[4]!.trim() };
}

// ── inbound-edge inversion ──────────────────────────────────────────────────

export const INVERSE_LABEL: Record<EdgeType, string> = {
  supersedes: 'superseded-by',
  refines: 'refined-by',
  relates: 'relates',
  'depends-on': 'required-by',
  contradicts: 'contradicts',
  parent: 'child',
};

/** Frontmatter (links included) needed to compute inbound edges. */
export interface NodeFrontmatter {
  id: string;
  links: { type: string; target: string }[];
  supersededBy: string | null;
}

/**
 * Compute inbound edges for `targetId` by scanning every node's outgoing links
 * (inverted via INVERSE_LABEL; unknown forward type → raw value as its own
 * inverse) plus any node whose `supersededBy === targetId`.
 */
export function computeInbound(all: NodeFrontmatter[], targetId: string): InboundEdge[] {
  const inbound: InboundEdge[] = [];
  for (const n of all) {
    if (n.id === targetId) continue;
    for (const link of n.links) {
      if (link.target !== targetId) continue;
      const label = EDGE_TYPES.includes(link.type as EdgeType)
        ? INVERSE_LABEL[link.type as EdgeType]
        : link.type; // unknown forward type → neutral, raw label
      inbound.push({ label, source: n.id });
    }
    if (n.supersededBy === targetId) {
      inbound.push({ label: 'superseded-by', source: n.id });
    }
  }
  return inbound;
}

// ── filesystem readers (confined, graceful) ─────────────────────────────────

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}
function isEacces(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === 'EACCES' || code === 'EPERM';
}

/** Read `index.md` rows. Missing file → []. */
export async function readIndex(root: string): Promise<IndexRow[]> {
  const dir = journalDirFor(root);
  const file = join(dir, 'index.md');
  assertInsideJournalDir(dir, file);
  let text: string;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if (isEnoent(e)) return [];
    if (isEacces(e)) throw e;
    return [];
  }
  const rows: IndexRow[] = [];
  for (const line of text.split('\n')) {
    const r = parseIndexRow(line);
    if (r) rows.push(r);
  }
  return rows;
}

/** Read `log.md` entries in file (append, chronological) order. Missing → []. */
export async function readLog(root: string): Promise<LogEntry[]> {
  const dir = journalDirFor(root);
  const file = join(dir, 'log.md');
  assertInsideJournalDir(dir, file);
  let text: string;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (e) {
    if (isEnoent(e)) return [];
    if (isEacces(e)) throw e;
    return [];
  }
  const out: LogEntry[] = [];
  for (const line of text.split('\n')) {
    const e = parseLogLine(line);
    if (e) out.push(e);
  }
  return out;
}

async function listNodeFiles(dir: string): Promise<string[]> {
  const nodesDir = join(dir, 'nodes');
  assertInsideJournalDir(dir, nodesDir);
  const entries = await fsp.readdir(nodesDir);
  return entries.filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
}

/** Read every node's full frontmatter (links included) — server-side, for the
 *  inbound-edge computation. Skips unparseable files. */
export async function readNodeFrontmatters(root: string): Promise<NodeFrontmatter[]> {
  if (USE_MOCK) return journalMock.readNodeFrontmatters();
  const dir = journalDirFor(root);
  let files: string[];
  try {
    files = await listNodeFiles(dir);
  } catch (e) {
    if (isEnoent(e)) return [];
    throw e;
  }
  const out: NodeFrontmatter[] = [];
  for (const f of files) {
    const file = join(dir, 'nodes', f);
    assertInsideJournalDir(dir, file);
    let raw: string;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const r = parseFrontmatter(raw, f);
    if (r.ok) {
      out.push({ id: r.node.id, links: r.node.links, supersededBy: r.node.supersededBy });
    }
  }
  return out;
}

/**
 * First-paint reconciliation read: list `nodes/` (source of truth), parse each
 * FRONTMATTER only, merge with `index.md` rows. Returns client-safe summaries
 * (no links/bodies). Graceful: missing dir → `empty`, EACCES → `unreadable`.
 */
export async function readAllNodes(root: string): Promise<JournalReadOutcome> {
  if (USE_MOCK) return journalMock.readAllNodes();
  const dir = journalDirFor(root);
  let files: string[];
  try {
    files = await listNodeFiles(dir);
  } catch (e) {
    if (isEnoent(e)) return { kind: 'empty' };
    if (isEacces(e)) return { kind: 'unreadable' };
    return { kind: 'empty' };
  }

  let index: IndexRow[];
  try {
    index = await readIndex(root);
  } catch (e) {
    if (isEacces(e)) return { kind: 'unreadable' };
    index = [];
  }
  const indexById = new Map(index.map((r) => [r.id, r]));

  const summaries: NodeSummary[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const f of files) {
    const file = join(dir, 'nodes', f);
    assertInsideJournalDir(dir, file);
    let raw: string;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch (e) {
      if (isEacces(e)) return { kind: 'unreadable' };
      continue;
    }
    const r = parseFrontmatter(raw, f);
    if (!r.ok) {
      skipped++;
      continue;
    }
    seen.add(r.node.id);
    summaries.push({
      id: r.node.id,
      title: r.node.title,
      status: r.node.status,
      tags: r.node.tags,
      date: r.node.date,
      filename: f,
    });
  }

  // index-only rows: file is gone → still list, flag missing.
  for (const row of index) {
    if (seen.has(row.id)) continue;
    summaries.push({
      id: row.id,
      title: row.title,
      status: row.status,
      tags: row.tags,
      date: row.date,
      filename: `nodes/${row.id}-*.md`,
      fileMissing: true,
    });
  }

  summaries.sort((a, b) => a.id.localeCompare(b.id));

  if (summaries.length === 0) return { kind: 'empty' };

  const log = await readLog(root).catch((e) => {
    if (isEacces(e)) throw e;
    return [] as LogEntry[];
  });
  // Merge index metadata is already folded; expose skippedCount.
  void indexById;
  return { kind: 'ok', nodes: summaries, log, skippedCount: skipped };
}

export type ReadNodeResult =
  | { ok: true; node: JournalNode }
  | { ok: false; error: NodeParseError };

/** Lazily read a single node BODY by id. Confined; id MUST be `^\d{4}$`. */
export async function readNode(root: string, id: string): Promise<ReadNodeResult> {
  if (USE_MOCK) return journalMock.readNode(id);
  if (!/^\d{4}$/.test(id)) {
    return { ok: false, error: { id: null, filename: id, reason: 'invalid node id' } };
  }
  const dir = journalDirFor(root);
  let files: string[];
  try {
    files = await listNodeFiles(dir);
  } catch {
    return { ok: false, error: { id, filename: `nodes/${id}-*.md`, reason: 'journal not found' } };
  }
  const match = files.find((f) => f.startsWith(`${id}-`));
  if (!match) {
    return { ok: false, error: { id, filename: `nodes/${id}-*.md`, reason: 'node file missing' } };
  }
  const file = join(dir, 'nodes', match);
  assertInsideJournalDir(dir, file);
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return { ok: false, error: { id, filename: match, reason: 'unreadable' } };
  }
  return parseFrontmatter(raw, match);
}
