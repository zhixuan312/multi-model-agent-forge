'use client';

import { Title, Text, TextSm, Eyebrow, Mono, Micro } from '@/components/ui';
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
          <TextSm className="font-medium text-amber">Could not parse this node.</TextSm>
          {parseError ? (
            <Mono className="mt-1 block !text-xs text-ink-soft">{parseError.filename}</Mono>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pl-4">
      <div className="flex items-center gap-2">
        <Mono className="!text-xs text-ink-faint">{node.id}</Mono>
        <StatusBadge status={node.status} />
        <Micro className="text-ink-faint">{node.date}</Micro>
      </div>
      <Title as="h2" className="mt-1 !text-xl">
        {node.title}
      </Title>
      {node.crux ? <Text className="mt-1 !text-sm italic">{node.crux}</Text> : null}

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
          <Eyebrow as="h3" className="text-ink-faint">Edges</Eyebrow>
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
        <Eyebrow as="h3" className="text-ink-faint">Context</Eyebrow>
        <Markdown className="mt-1">{node.context || '_(none)_'}</Markdown>
      </section>
      <section className="mt-4">
        <Eyebrow as="h3" className="text-ink-faint">Consequences</Eyebrow>
        <Markdown className="mt-1">{node.consequences || '_(none)_'}</Markdown>
      </section>

      <Mono className="mt-4 block !text-[11px] text-ink-faint">{node.filename}</Mono>
    </div>
  );
}
