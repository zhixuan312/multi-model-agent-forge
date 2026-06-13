'use client';

import { FileText } from 'lucide-react';
import { Title, Eyebrow, Mono, Micro, TextSm } from '@/components/ui';
import { Markdown } from '@/components/forge/Markdown';
import { StatusBadge } from '@/components/forge/journal/StatusBadge';
import { cn } from '@/lib/cn';
import type { JournalNode, InboundEdge, NodeParseError } from '@/journal/types';

/** Category tint — mirrors the journal-stage / Nodes-list chips. */
const CAT_STYLE: Record<string, string> = {
  decision: 'bg-accent-tint text-accent',
  design: 'bg-[var(--frost)] text-[var(--steel)]',
  behavior: 'bg-sage-tint text-[var(--sage-deep)]',
  process: 'bg-amber-tint text-[var(--amber)]',
  knowledge: 'bg-rose-tint text-[var(--rose)]',
  style: 'bg-surface-2 text-ink-soft',
};

/**
 * The Nodes detail pane (Spec 6) — an editorial "knowledge card" on a two-column
 * doc layout: the knowledge (title, crux, Context, Consequences) reads down the
 * left at a comfortable measure, while a right sidebar carries the relationships
 * (grouped by type) and the source file — so the wide pane fills professionally
 * instead of leaving the right half empty. READ-ONLY. An unparseable node renders
 * a "couldn't parse" pane.
 */
export function NodeDetail({
  node,
  parseError,
  inbound,
  onNavigate,
}: {
  node: JournalNode | null;
  parseError?: NodeParseError | null;
  inbound: InboundEdge[];
  onNavigate: (id: string) => void;
}) {
  if (!node) {
    return (
      <div className="w-full pr-6">
        <div className="rounded-[var(--r-md)] border border-dashed border-amber bg-amber-tint/40 p-4">
          <TextSm className="font-medium text-amber">Could not parse this node.</TextSm>
          {parseError ? (
            <Mono className="mt-1 block !text-xs text-ink-soft">{parseError.filename}</Mono>
          ) : null}
        </div>
      </div>
    );
  }

  const rels = groupEdges(node.links, inbound);
  const edgeCount = rels.reduce((s, r) => s + r.ids.length, 0);

  return (
    <article className="w-full">
      {/* ── Header (full width) ────────────────────────────── */}
      <header>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Mono className="!text-xs text-ink-faint">{node.id}</Mono>
          {node.category ? (
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CAT_STYLE[node.category])}>
              {node.category}
            </span>
          ) : null}
          <StatusBadge status={node.status} />
          <Micro className="text-ink-faint">{node.date}</Micro>
        </div>

        <Title as="h2" className="mt-2.5 !text-2xl !leading-snug">
          {node.title}
        </Title>

        {node.crux ? (
          <p className="mt-3 max-w-[64ch] border-l-2 border-accent/35 pl-3.5 text-[15px] italic leading-relaxed text-ink-soft">
            {node.crux}
          </p>
        ) : null}
      </header>

      <hr className="my-5 border-line" />

      {/* ── Knowledge (left) ∣ Metadata sidebar (right) ────── */}
      <div className="grid gap-x-8 gap-y-7 lg:grid-cols-[minmax(0,1fr)_290px]">
        <div className="flex min-w-0 flex-col gap-5">
          <KnowledgeSection label="Context" body={node.context} />
          <KnowledgeSection label="Consequences" body={node.consequences} />
        </div>

        <aside className="flex min-w-0 flex-col gap-6 lg:border-l lg:border-line lg:pl-7">
          {node.tags.length ? (
            <section>
              <Eyebrow as="h3" className="text-ink-faint">Tags</Eyebrow>
              <div className="mt-2 flex flex-wrap gap-1">
                {node.tags.map((t) => (
                  <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-soft">
                    {t}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {rels.length ? (
            <section>
              <Eyebrow as="h3" className="flex items-center gap-2 text-ink-faint">
                Relationships
                <span className="rounded-full bg-surface px-1.5 text-[10px] font-normal text-ink-faint ring-1 ring-line">
                  {edgeCount}
                </span>
              </Eyebrow>
              <dl className="mt-3 flex flex-col gap-3">
                {rels.map((r) => (
                  <div key={r.key}>
                    <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
                      <span aria-hidden className="text-ink-faint">{arrowFor(r)}</span>
                      <span className="truncate">{r.label}</span>
                    </dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {r.ids.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onNavigate(id)}
                          aria-label={`Open node ${id}`}
                          className="focus-ring rounded-[var(--r-sm)] border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-soft transition-colors hover:border-accent hover:text-accent-deep"
                        >
                          {id}
                        </button>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section className="flex items-center gap-1.5 border-t border-line pt-3 text-ink-faint">
            <FileText className="size-3.5 shrink-0" />
            <Mono className="!text-[11px] break-all">{node.filename}</Mono>
          </section>
        </aside>
      </div>
    </article>
  );
}

/** One labelled knowledge block, set at a readable measure. */
function KnowledgeSection({ label, body }: { label: string; body: string }) {
  return (
    <section>
      <Eyebrow as="h3" className="text-ink-faint">{label}</Eyebrow>
      <Markdown className="mt-1.5 prose-p:my-2.5 prose-p:text-[15px] prose-p:leading-relaxed prose-p:text-ink-soft prose-li:text-[15px] prose-li:text-ink-soft prose-strong:text-ink">
        {body || '_(none)_'}
      </Markdown>
    </section>
  );
}

// ── edge grouping ─────────────────────────────────────────────
type Rel = { key: string; label: string; ids: string[]; dirs: Set<'in' | 'out'> };

/** Lineage → dependency → hierarchy → association → conflict. Unknown labels last. */
const REL_ORDER = [
  'supersedes', 'superseded-by',
  'refines', 'refined-by',
  'depends-on', 'required-by',
  'parent', 'child',
  'relates',
  'contradicts', 'contradicted-by',
];

function groupEdges(links: JournalNode['links'], inbound: InboundEdge[]): Rel[] {
  const map = new Map<string, Rel>();
  const add = (label: string, dir: 'in' | 'out', id: string) => {
    let r = map.get(label);
    if (!r) {
      r = { key: label, label, ids: [], dirs: new Set() };
      map.set(label, r);
    }
    r.dirs.add(dir);
    if (!r.ids.includes(id)) r.ids.push(id);
  };
  for (const l of links) add(l.type, 'out', l.target);
  for (const e of inbound) add(e.label, 'in', e.source);

  const rels = [...map.values()];
  for (const r of rels) r.ids.sort((a, b) => a.localeCompare(b));
  return rels.sort((a, b) => {
    const ia = REL_ORDER.indexOf(a.label);
    const ib = REL_ORDER.indexOf(b.label);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.label.localeCompare(b.label);
  });
}

function arrowFor(r: Rel): string {
  return r.dirs.has('in') && r.dirs.has('out') ? '↔' : r.dirs.has('in') ? '←' : '→';
}
