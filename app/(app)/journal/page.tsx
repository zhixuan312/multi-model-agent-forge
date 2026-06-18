import { existsSync } from 'node:fs';
import type { ReactNode } from 'react';
import {
  Hexagon,
  CheckCircle2,
  Archive,
  History,
  Pin,
  MessageCircleQuestion,
  Search,
  Share2,
  GitFork,
  PlusCircle,
  ListChecks,
} from 'lucide-react';
import { PageFrame, MetricCard } from '@/components/ui';
import { JournalTabsNav, type JournalView } from '@/components/forge/journal/JournalTabsNav';
import { JournalState } from '@/components/forge/journal/journal-shell';
import { RecallTab } from '@/components/forge/journal/RecallTab';
import { NodesTab } from '@/components/forge/journal/NodesTab';
import { GraphTab } from '@/components/forge/journal/GraphTab';
import { LogTab } from '@/components/forge/journal/LogTab';
import { resolveWorkspaceRoot } from '@/git/workspace-root';
import { readAllNodes, readNodeFrontmatters } from '@/journal/store-reader';
import { buildGraphEdges, type GraphNode, type GraphEdge } from '@/journal/graph';
import { currentMember } from '@/auth/current-member';
import { listPins } from '@/journal/pins-core';
import { topFaqs } from '@/journal/faqs-core';
import { currentJournalLogCount, isPinStale } from '@/journal/journal-rev';
import { formatDate } from '@/lib/format-relative';
import type { JournalReadOutcome } from '@/journal/types';
import type { IndexLookupRow } from '@/journal/citations';
import type { PinnedView, FaqView } from '@/journal/recall-content';

/**
 * `/journal` — the team decision-graph viewer (Spec 6), on the Team-Settings
 * shell. The tabs live in the header sub-nav; the STATUS row re-skins per tab,
 * and the body is the active view in a 2/3 ∣ 1/3 surface. READ-ONLY (F10). Data
 * is read from MMA's `.mma/journal/` at the workspace root, or seeded in mock
 * mode. Graceful: absent root → config-needed; empty → empty; unreadable →
 * diagnostic. Never 500.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Metric = {
  label: string;
  value: ReactNode;
  sublabel: string;
  icon: ReactNode;
  iconTint: 'rose' | 'accent' | 'sage' | 'steel' | 'amber';
  muted?: boolean;
};

function normalizeView(v: string | undefined): JournalView {
  return v === 'recall' || v === 'graph' || v === 'log' ? v : 'nodes';
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; node?: string }>;
}) {
  const { view: rawView, node } = await searchParams;
  const view = normalizeView(rawView);
  const root = resolveWorkspaceRoot();

  let read: JournalReadOutcome;
  if (!existsSync(root)) {
    read = { kind: 'unconfigured' };
  } else {
    read = await readAllNodes(root);
  }

  const frame = (body: ReactNode) => (
    <PageFrame title="Journal" subnav={<JournalTabsNav active={view} />} width="full" fill>
      {body}
    </PageFrame>
  );

  if (read.kind !== 'ok') {
    return frame(<JournalState kind={read.kind} />);
  }

  // Recall standing content (the caller's pinned Q&A + the team's auto-derived
  // FAQs) — loaded only for the Recall tab. Staleness is server-derived from the
  // current journal log length vs. each pin's cached marker. A loader failure
  // here bubbles to the page-level error boundary (the journal still rendered
  // its nodes above, so this is the existing not-500 path). Pins are per-member;
  // an anonymous render (shouldn't happen under the authed shell) shows none.
  let pinned: PinnedView[] = [];
  let faqs: FaqView[] = [];
  if (view === 'recall') {
    const me = await currentMember();
    const logCount = await currentJournalLogCount(root);
    const [rawPins, topQ] = await Promise.all([
      me ? listPins(me.id) : Promise.resolve([]),
      topFaqs(),
    ]);
    pinned = rawPins.map((p) => ({
      id: p.id,
      question: p.question,
      answerMd: p.answerMd,
      findings: p.findings,
      citationIds: p.citationIds,
      journalLogCount: p.journalLogCount,
      stale: isPinStale(p.journalLogCount, logCount),
    }));
    faqs = topQ;
  }

  // Graph data (only when the Graph tab is active — one extra read).
  let graphNodes: GraphNode[] = [];
  let graphEdges: GraphEdge[] = [];
  if (view === 'graph') {
    const ids = new Set(read.nodes.map((n) => n.id));
    const frontmatters = await readNodeFrontmatters(root);
    graphNodes = read.nodes.map((n) => ({ id: n.id, status: n.status, title: n.title, source: n.source, category: n.category }));
    graphEdges = buildGraphEdges(frontmatters, ids);
  }

  const metrics = statusFor(view, read, { pinned, faqs, graphNodes, graphEdgeCount: graphEdges.length });
  const indexRows: IndexLookupRow[] = read.nodes.map((n) => ({ id: n.id, title: n.title, status: n.status }));

  return frame(
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <MetricCard
            key={m.label}
            label={m.label}
            value={m.value}
            sublabel={m.sublabel}
            icon={m.icon}
            iconTint={m.iconTint}
            muted={m.muted}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {view === 'recall' ? <RecallTab index={indexRows} pinned={pinned} faqs={faqs} /> : null}
        {view === 'nodes' ? <NodesTab nodes={read.nodes} skippedCount={read.skippedCount} initialNode={node} /> : null}
        {view === 'graph' ? <GraphTab nodes={graphNodes} edges={graphEdges} /> : null}
        {view === 'log' ? <LogTab log={read.log} /> : null}
      </div>
    </div>,
  );
}

type Ok = Extract<JournalReadOutcome, { kind: 'ok' }>;

function statusFor(
  view: JournalView,
  read: Ok,
  extra: { pinned: PinnedView[]; faqs: FaqView[]; graphNodes: GraphNode[]; graphEdgeCount: number },
): Metric[] {
  const total = read.nodes.length;
  const adopted = read.nodes.filter((n) => n.status === 'adopted').length;
  const superseded = read.nodes.filter((n) => n.status === 'superseded').length;
  const last = read.log.length ? read.log[read.log.length - 1]!.date : null;
  const lastRecorded = last ? formatDate(new Date(last)) : null;

  if (view === 'recall') {
    return [
      { label: 'Pinned Q&A', value: extra.pinned.length, muted: extra.pinned.length === 0, sublabel: 'Saved answers', icon: <Pin />, iconTint: 'accent' },
      { label: 'Common questions', value: extra.faqs.length, muted: extra.faqs.length === 0, sublabel: 'Frequently asked', icon: <MessageCircleQuestion />, iconTint: 'rose' },
      { label: 'Nodes searchable', value: total, sublabel: 'Across the journal', icon: <Search />, iconTint: 'steel' },
      { label: 'Last recorded', value: lastRecorded ?? '—', muted: !lastRecorded, sublabel: 'Most recent entry', icon: <History />, iconTint: 'sage' },
    ];
  }

  if (view === 'graph') {
    return [
      { label: 'Nodes', value: extra.graphNodes.length, sublabel: 'In the network', icon: <Hexagon />, iconTint: 'accent' },
      { label: 'Edges', value: extra.graphEdgeCount, muted: extra.graphEdgeCount === 0, sublabel: 'Typed relationships', icon: <Share2 />, iconTint: 'steel' },
      { label: 'Adopted', value: adopted, muted: adopted === 0, sublabel: 'Live learnings', icon: <CheckCircle2 />, iconTint: 'sage' },
      { label: 'Superseded', value: superseded, muted: superseded === 0, sublabel: 'Replaced', icon: <Archive />, iconTint: 'amber' },
    ];
  }

  if (view === 'log') {
    const creates = read.log.filter((e) => e.op === 'create').length;
    const supersessions = read.log.filter((e) => e.op === 'supersede').length;
    return [
      { label: 'Entries', value: read.log.length, muted: read.log.length === 0, sublabel: 'Total log events', icon: <ListChecks />, iconTint: 'accent' },
      { label: 'Creates', value: creates, muted: creates === 0, sublabel: 'New nodes', icon: <PlusCircle />, iconTint: 'sage' },
      { label: 'Supersessions', value: supersessions, muted: supersessions === 0, sublabel: 'Replacements', icon: <GitFork />, iconTint: 'amber' },
      { label: 'Last recorded', value: lastRecorded ?? '—', muted: !lastRecorded, sublabel: 'Most recent entry', icon: <History />, iconTint: 'steel' },
    ];
  }

  // nodes (default)
  return [
    { label: 'Nodes', value: total, sublabel: 'Decision graph', icon: <Hexagon />, iconTint: 'accent' },
    { label: 'Adopted', value: adopted, muted: adopted === 0, sublabel: 'Live learnings', icon: <CheckCircle2 />, iconTint: 'sage' },
    { label: 'Superseded', value: superseded, muted: superseded === 0, sublabel: 'Replaced', icon: <Archive />, iconTint: 'amber' },
    { label: 'Last recorded', value: lastRecorded ?? '—', muted: !lastRecorded, sublabel: 'Most recent entry', icon: <History />, iconTint: 'steel' },
  ];
}
