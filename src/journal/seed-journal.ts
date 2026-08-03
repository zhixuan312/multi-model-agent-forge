/**
 * Seed the team journal — `pnpm db:seed-journal`.
 *
 * Writes the demo journal dataset as REAL MMA-format files under the workspace
 * root (`<workspaceRoot>/.mma/journal/{nodes/<id>-<slug>.md, log.md, index.md,
 * schema.md}`), the single team-level location every recall/record (journal
 * page, loops, projects) reads and writes. This replaces the old in-memory mock:
 * once seeded, the journal page reads these files directly, and MMA's
 * `journal_record` appends new nodes here as runs produce learnings.
 *
 * It is a SEED (initial demo population), so it overwrites the seed-managed files
 * (nodes/, log.md, index.md, schema.md). Re-running gives a clean dataset.
 *
 * ## It refuses to run over a journal that already has nodes
 *
 * That "clean dataset" is a DELETION: `rmSync(nodesDir, { recursive: true })` on the one
 * team-level store every recall reads and `journal_record` appends to. A team's accumulated
 * learnings live there and nothing else backs them up.
 *
 * The script sat in `package.json` beside `db:seed-templates` — which the README tells
 * operators to run during bootstrap — and appeared in no documentation at all, so the only
 * way to know it was destructive was to read this file. It now requires `--force` (or
 * `{ force: true }`) once the store holds nodes, and says what it would have destroyed.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import type { JournalNode, LogEntry } from '@/journal/types';
import { journalDirFor } from '@/journal/store-reader';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, 'seed-data');

function loadNodes(): JournalNode[] {
  return JSON.parse(readFileSync(join(SEED_DIR, 'journal-nodes.json'), 'utf8')) as JournalNode[];
}
function loadLog(): LogEntry[] {
  return JSON.parse(readFileSync(join(SEED_DIR, 'journal-log.json'), 'utf8')) as LogEntry[];
}

/** A double-quoted YAML scalar (data has no embedded quotes; asserted by the seed). */
function q(s: string): string {
  return `"${s}"`;
}

/** Render one node as an MMA node markdown file (frontmatter + crux + body). */
export function renderNode(n: JournalNode): string {
  // OKF frontmatter order: id, title, type, status, tags, timestamp, links, …, description
  const fm: string[] = ['---', `id: ${q(n.id)}`, `title: ${q(n.title)}`];
  if (n.type) fm.push(`type: ${q(n.type)}`);
  fm.push(`status: ${q(n.status)}`);
  if (n.tags.length) {
    fm.push('tags:');
    for (const t of n.tags) fm.push(`  - ${t}`);
  } else {
    fm.push('tags: []');
  }
  fm.push(`timestamp: ${q(n.timestamp)}`);
  if (n.links.length) {
    fm.push('links:');
    for (const l of n.links) {
      fm.push(`  - type: ${q(l.type)}`);
      fm.push(`    target: ${q(l.target)}`);
    }
  } else {
    fm.push('links: []');
  }
  fm.push(`supersededBy: ${n.supersededBy ? q(n.supersededBy) : 'null'}`);
  if (n.source) fm.push(`source: ${q(n.source)}`);
  if (n.description) fm.push(`description: ${q(n.description)}`);
  fm.push('---', '');

  const body: string[] = [];
  if (n.crux) body.push(n.crux, '');
  body.push('## Context', n.context.trim(), '');
  body.push('## Consequences', n.consequences.trim(), '');
  return [...fm, ...body].join('\n');
}

/** Render `index.md` — a table sorted by id; pipes in cells are escaped. */
export function renderIndex(nodes: JournalNode[]): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const rows = [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => `| ${n.id} | ${n.timestamp} | ${n.type ?? ''} | ${n.status} | ${cell(n.title)} | ${n.tags.join(', ')} |`);
  return [
    '| id | timestamp | type | status | title | tags |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n') + '\n';
}

/** Render `log.md` — one whitespace-delimited line per write, file order. */
export function renderLog(log: LogEntry[]): string {
  return log.map((e) => `${e.timestamp}  ${e.op}  ${e.id}  ${e.title}`).join('\n') + '\n';
}

const SCHEMA_MD = `# Journal schema (conventions — do not override the rules below)

## Node id
Zero-padded 4-digit string, allocated as max(existing) + 1.

## Filename
\`nodes/<id>-<kebab-case-title>.md\`.

## Status (fixed enum)
adopted | dropped | inconclusive | superseded

## Edge types (fixed set)
supersedes | refines | relates | depends-on | contradicts | parent

## Tags
Free-form lowercase kebab-case.

## index.md
Markdown table: id | timestamp | type | status | title | tags — one row per node, sorted by id ascending.

## log.md
Append-only, one line per write: <ISO-8601 timestamp>  <op>  <id>  <title>  (op ∈ create|refine|supersede|merge).

This file's prose/tag guidance is human-editable; the status enum, edge-type set,
and id/filename rules are fixed by code and may not be overridden here.
`;

/** Thrown when the target journal already holds nodes and `force` was not given. */
export class JournalNotEmptyError extends Error {
  constructor(readonly dir: string, readonly existingNodes: number) {
    super(
      `${dir} already holds ${existingNodes} journal node(s). Seeding DELETES them. ` +
      'Re-run with --force if that is really what you want.',
    );
    this.name = 'JournalNotEmptyError';
  }
}

/** How many `nodes/*.md` the store already holds (0 when the directory is absent). */
function existingNodeCount(nodesDir: string): number {
  try {
    return readdirSync(nodesDir).filter((f) => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

export function seedJournal(
  root = resolveWorkspaceRoot(),
  opts: { force?: boolean } = {},
): { dir: string; nodes: number; log: number } {
  const nodes = loadNodes();
  const log = loadLog();
  const dir = journalDirFor(root);
  const nodesDir = join(dir, 'nodes');

  // Refuse to delete a journal someone is actually using. See the header.
  const existing = existingNodeCount(nodesDir);
  if (existing > 0 && !opts.force) throw new JournalNotEmptyError(dir, existing);

  // Fresh seed of the managed files (leave any unrelated files in the dir alone).
  rmSync(nodesDir, { recursive: true, force: true });
  mkdirSync(nodesDir, { recursive: true });

  for (const n of nodes) {
    const filename = n.filename.replace(/^nodes\//, '');
    writeFileSync(join(nodesDir, filename), renderNode(n), 'utf8');
  }
  writeFileSync(join(dir, 'log.md'), renderLog(log), 'utf8');
  writeFileSync(join(dir, 'index.md'), renderIndex(nodes), 'utf8');
  writeFileSync(join(dir, 'schema.md'), SCHEMA_MD, 'utf8');

  return { dir, nodes: nodes.length, log: log.length };
}

// Run when invoked directly (tsx src/journal/seed-journal.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { dir, nodes, log } = seedJournal(undefined, { force: process.argv.includes('--force') });
    console.log(`Seeded ${nodes} nodes + ${log} log entries → ${dir}`);
  } catch (err) {
    if (err instanceof JournalNotEmptyError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
