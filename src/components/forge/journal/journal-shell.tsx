'use client';

import { useEffect, useState } from 'react';
import { BookOpen, History } from 'lucide-react';
import { NodeDetail } from '@/components/forge/journal/NodeDetail';
import { EmptyState, Banner, TextSm } from '@/components/ui';
import type { JournalNode, InboundEdge, NodeParseError } from '@/journal/types';

/**
 * Shared building blocks for the journal tab views: the lazy node-body loader
 * and the non-ok read states. Each tab composes the canonical `StatusDashboard`
 * (patterns/status-dashboard.tsx) for its 2/3 ∣ 1/3 split — see any of the tabs.
 */

/** Lazy-loads one node's BODY + server-computed inbound edges on selection. */
export function LazyNodeDetail({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'ready'; node: JournalNode | null; parseError: NodeParseError | null; inbound: InboundEdge[] }
    | { phase: 'error' }
  >({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to loading before fetching the node for the new id
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
