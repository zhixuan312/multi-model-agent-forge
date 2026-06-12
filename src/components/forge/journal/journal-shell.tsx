'use client';

import { useEffect, useState } from 'react';
import { BookOpen, History } from 'lucide-react';
import { NodeDetail } from '@/components/forge/journal/NodeDetail';
import { EmptyState, Banner, TextSm } from '@/components/ui';
import type { JournalNode, InboundEdge, NodeParseError } from '@/journal/types';

/**
 * Shared building blocks for the journal tab views: the 2/3 ∣ 1/3 row, the
 * lazy node-body loader, and the non-ok read states. Kept here so each tab
 * (Recall · Nodes · Graph · Write log) composes the same shell.
 */

/**
 * The 2/3 primary ∣ 1/3 rail row used by every tab. On lg it FILLS its parent's
 * height (`lg:h-full`) and stretches both columns to the page bottom, so each
 * tab's cards extend to the bottom and scroll internally (like Write log).
 */
export function RailLayout({ children, rail }: { children: React.ReactNode; rail: React.ReactNode }) {
  return (
    <div className="grid min-h-0 grid-cols-1 gap-4 lg:h-full lg:grid-cols-3 lg:items-stretch">
      <div className="flex min-h-0 flex-col lg:col-span-2">{children}</div>
      <div className="flex min-h-0 flex-col gap-4">{rail}</div>
    </div>
  );
}

/** Lazy-loads one node's BODY + server-computed inbound edges on selection. */
export function LazyNodeDetail({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
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
    return <TextSm className="!text-ink-faint">Loading node {id}…</TextSm>;
  }
  if (state.phase === 'error') {
    return <TextSm className="!text-rose">Could not load node {id}.</TextSm>;
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
export function JournalState({ kind }: { kind: 'empty' | 'unreadable' | 'unconfigured' }) {
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
