'use client';

import { Markdown } from '@/components/forge/Markdown';
import { StatusBadge } from '@/components/forge/journal/StatusBadge';
import { EdgeChip } from '@/components/forge/journal/EdgeChip';
import type { JournalNode, InboundEdge, NodeParseError } from '@/journal/types';

/**
 * The Nodes detail pane (Spec 6). Renders one node: status, title-as-crux, the
 * optional crux subtitle, tags, typed edges (outgoing from `links` + the
 * server-computed inbound list), Context + Consequences (sanitized markdown),
 * and the source filename. An unparseable node renders a "couldn't parse" pane.
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
      <div className="flex-1 pl-4">
        <div className="rounded-[var(--r-md)] border border-dashed border-amber bg-amber-tint/40 p-4">
          <p className="text-sm font-medium text-amber">Could not parse this node.</p>
          {parseError ? (
            <p className="mt-1 font-mono text-xs text-ink-soft">{parseError.filename}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pl-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-ink-faint">{node.id}</span>
        <StatusBadge status={node.status} />
        <span className="text-xs text-ink-faint">{node.date}</span>
      </div>
      <h2 className="mt-1 font-serif text-xl font-semibold text-ink">{node.title}</h2>
      {node.crux ? <p className="mt-1 text-sm italic text-ink-soft">{node.crux}</p> : null}

      {node.tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {node.tags.map((t) => (
            <span
              key={t}
              className="rounded-[var(--r-sm)] bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-soft"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}

      {(node.links.length > 0 || inbound.length > 0) ? (
        <div className="mt-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Edges</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {node.links.map((l, i) => (
              <EdgeChip
                key={`out-${i}`}
                type={l.type}
                node={l.target}
                direction="out"
                onNavigate={onNavigate}
              />
            ))}
            {inbound.map((e, i) => (
              <EdgeChip
                key={`in-${i}`}
                type={e.label}
                node={e.source}
                direction="in"
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ) : null}

      <section className="mt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Context</h3>
        <Markdown className="mt-1">{node.context || '_(none)_'}</Markdown>
      </section>
      <section className="mt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Consequences
        </h3>
        <Markdown className="mt-1">{node.consequences || '_(none)_'}</Markdown>
      </section>

      <p className="mt-4 font-mono text-[11px] text-ink-faint">{node.filename}</p>
    </div>
  );
}
