'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { NodesView } from '@/components/forge/journal/NodesView';
import { NodeDetail } from '@/components/forge/journal/NodeDetail';
import { WriteLogView } from '@/components/forge/journal/WriteLogView';
import { RecallView } from '@/components/forge/journal/RecallView';
import { BookOpen, Hexagon, History } from 'lucide-react';
import { Badge, Eyebrow, EmptyState, Banner, TextSm } from '@/components/ui';
import { STATUS_VALUES } from '@/journal/types';
import type {
  JournalReadOutcome,
  JournalNode,
  InboundEdge,
  NodeParseError,
} from '@/journal/types';
import { cn } from '@/lib/cn';

/**
 * The Journal viewer client island (Spec 6). Owns the active tab (`?view=`,
 * default `nodes`), the selected node (`?node=`), the lazy node-body fetch, and
 * the header pills. The three tabs use ARIA `tablist`/`tab`/`tabpanel` semantics
 * and are keyboard-navigable (arrow keys move, Enter/Space activate — F9). This
 * page is READ-ONLY: there is no write/edit affordance anywhere (F10).
 */

type View = 'recall' | 'nodes' | 'log';
const VIEWS: { id: View; label: string; glyph: React.ReactNode }[] = [
  { id: 'recall', label: 'Recall', glyph: <BookOpen className="size-4" /> },
  { id: 'nodes', label: 'Nodes', glyph: <Hexagon className="size-4" /> },
  { id: 'log', label: 'Write log', glyph: <History className="size-4" /> },
];

function normalizeView(v: string | null | undefined): View {
  return v === 'recall' || v === 'log' ? v : 'nodes';
}

export function JournalTabs({
  read,
  initialView,
  initialNode,
}: {
  read: JournalReadOutcome;
  initialView?: string;
  initialNode?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const view = normalizeView(initialView ?? searchParams.get('view'));
  const selectedId = initialNode ?? searchParams.get('node');

  function go(nextView: View, nextNode?: string | null) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('view', nextView);
    if (nextNode) sp.set('node', nextNode);
    else sp.delete('node');
    router.push(`${pathname}?${sp.toString()}`);
  }

  // Non-ok read outcomes render a state, never a crash.
  if (read.kind !== 'ok') {
    return <JournalState kind={read.kind} />;
  }

  const indexRows = read.nodes.map((n) => ({ id: n.id, title: n.title, status: n.status }));

  return (
    <div className="flex flex-col gap-4">
      <HeaderPills read={read} />
      <TabBar view={view} onActivate={(v) => go(v)} />

      {view === 'recall' ? (
        <div role="tabpanel" id="panel-recall" aria-labelledby="tab-recall">
          <RecallView index={indexRows} onNavigate={(id) => go('nodes', id)} />
        </div>
      ) : null}

      {view === 'nodes' ? (
        <div role="tabpanel" id="panel-nodes" aria-labelledby="tab-nodes" className="flex gap-4">
          <NodesView
            nodes={read.nodes}
            skippedCount={read.skippedCount}
            selectedId={selectedId}
            onSelect={(id) => go('nodes', id)}
          />
          {selectedId ? (
            <LazyNodeDetail id={selectedId} onNavigate={(id) => go('nodes', id)} />
          ) : (
            <TextSm className="flex-1 pl-4 !text-ink-faint">Select a node to view its detail.</TextSm>
          )}
        </div>
      ) : null}

      {view === 'log' ? (
        <div role="tabpanel" id="panel-log" aria-labelledby="tab-log">
          <WriteLogView log={read.log} onNavigate={(id) => go('nodes', id)} />
        </div>
      ) : null}
    </div>
  );
}

/** The ARIA tablist. Arrow keys roving-focus; Enter/Space activate. */
function TabBar({ view, onActivate }: { view: View; onActivate: (v: View) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (idx + 1) % VIEWS.length;
      refs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (idx - 1 + VIEWS.length) % VIEWS.length;
      refs.current[prev]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate(VIEWS[idx]!.id);
    }
  }

  return (
    <div role="tablist" aria-label="Journal views" className="flex gap-1 border-b border-line">
      {VIEWS.map((v, i) => {
        const selected = view === v.id;
        return (
          <button
            key={v.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`tab-${v.id}`}
            aria-selected={selected}
            aria-controls={`panel-${v.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onActivate(v.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
              selected
                ? 'border-accent font-medium text-ink'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            <span aria-hidden className="inline-flex">
              {v.glyph}
            </span>
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

/** node-count pill (parsed nodes only) + per-known-status count pills (F3/F10). */
function HeaderPills({ read }: { read: Extract<JournalReadOutcome, { kind: 'ok' }> }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of read.nodes) {
      if ((STATUS_VALUES as readonly string[]).includes(n.status)) {
        c[n.status] = (c[n.status] ?? 0) + 1;
      }
    }
    return c;
  }, [read.nodes]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Eyebrow>Anvil Team · decision graph</Eyebrow>
      <Badge data-testid="pill-node-count" size="sm">
        {read.nodes.length} nodes
      </Badge>
      {STATUS_VALUES.map((s) =>
        counts[s] ? (
          <Badge key={s} data-testid={`pill-status-${s}`} size="sm">
            {s} {counts[s]}
          </Badge>
        ) : null,
      )}
    </div>
  );
}

/** Lazy-loads one node's BODY + server-computed inbound edges on selection. */
function LazyNodeDetail({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'ready'; node: JournalNode | null; parseError: NodeParseError | null; inbound: InboundEdge[] }
    | { phase: 'error' }
  >({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    fetch(`/api/journal/nodes/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load failed'))))
      .then((json) => {
        if (!alive) return;
        setState({
          phase: 'ready',
          node: json.node ?? null,
          parseError: json.parseError ?? null,
          inbound: json.inbound ?? [],
        });
      })
      .catch(() => alive && setState({ phase: 'error' }));
    return () => {
      alive = false;
    };
  }, [id]);

  if (state.phase === 'loading') {
    return <TextSm className="flex-1 pl-4 !text-ink-faint">Loading node {id}…</TextSm>;
  }
  if (state.phase === 'error') {
    return <TextSm className="flex-1 pl-4 !text-rose">Could not load node {id}.</TextSm>;
  }
  return (
    <NodeDetail
      node={state.node}
      parseError={state.parseError}
      inbound={state.inbound}
      onNavigate={onNavigate}
    />
  );
}

/** Empty / unreadable / unconfigured states (never a 500). */
function JournalState({ kind }: { kind: 'empty' | 'unreadable' | 'unconfigured' }) {
  if (kind === 'unconfigured') {
    return (
      <EmptyState
        icon={<History />}
        title="Journal not configured"
        description="An admin must configure the workspace root in Team Settings."
      />
    );
  }
  if (kind === 'unreadable') {
    return (
      <Banner
        variant="warning"
        title="Team journal is unreadable by Forge"
        description="Check that Forge and MMA run as the same OS user, or that the journal dir is group-readable."
      />
    );
  }
  return (
    <EmptyState
      icon={<BookOpen />}
      title="No team learnings yet"
      description="Recorded at project freeze."
    />
  );
}
