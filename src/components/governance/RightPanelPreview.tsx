'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, GitBranch, Loader2, PencilLine, RotateCcw, Search, Shield } from 'lucide-react';
import {
  Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle, Label, Micro, Mono,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui';
import { StageNavigator, type NavGroup } from '@/components/patterns/stage-navigator';
import { RecordList, RecordCard } from '@/components/patterns/record-list';
import { AuditRoundCard, type Finding } from '@/components/patterns/findings';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { StatusBadge } from '@/components/forge/journal/StatusBadge';
import { cn } from '@/lib/cn';
import { RIGHT_PANEL_VARIANTS, defaultEnabledAffordances } from '@/components/governance/variant-meta';

/** Static shape of the demo navigator's work-items (approval state is held in NavigatorDemo). */
const NAV_ITEMS = [
  { group: 'a', groupLabel: 'Phase A — foundation', id: '1', title: 'Confirm the repository seam', index: 1, repo: 'main', files: 1 },
  { group: 'a', groupLabel: 'Phase A — foundation', id: '2', title: 'Add the misuse warning', index: 2, repo: 'main', files: 2 },
  { group: 'b', groupLabel: 'Phase B — feature', id: '3', title: 'Offline-safe interpret route', index: 3, repo: 'main', files: 2 },
];
const NAV_IDS = NAV_ITEMS.map((i) => i.id);

/**
 * Fully-interactive Navigator demo (a mini state machine, like StageFlowDemo). Two
 * independent mechanics — matching the real Plan rail:
 *  - click an item → SELECTS it (accent border, one at a time; item 1 selected by default)
 *  - Approve all / Revoke all → bulk APPROVAL (✓ tiles); selection is untouched, so a
 *    selected + approved item shows both the accent border and the green tile
 *  - the advance footer stays disabled until every item is approved
 */
function NavigatorDemo({ on }: { on: ReadonlySet<string> }) {
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
  const [activeId, setActiveId] = useState('1');
  const allApproved = approved.size === NAV_IDS.length;

  const toggleAll = () => setApproved(allApproved ? new Set() : new Set(NAV_IDS));

  const meta = (repo: string, files: number) => (
    <>
      <span className="inline-flex items-center gap-0.5"><GitBranch className="size-2.5" /> {repo}</span>
      <span>{files} files</span>
    </>
  );

  const groups: NavGroup[] = [];
  for (const it of NAV_ITEMS) {
    let g = groups.find((x) => x.id === it.group);
    if (!g) {
      g = { id: it.group, label: on.has('sectionHeaders') ? it.groupLabel : undefined, items: [] };
      groups.push(g);
    }
    g.items.push({
      id: it.id,
      title: it.title,
      index: it.index,
      active: activeId === it.id,
      done: approved.has(it.id),
      meta: on.has('itemMeta') ? meta(it.repo, it.files) : undefined,
      onClick: () => setActiveId(it.id),
    });
  }

  return (
    <div className="max-w-sm">
      <StageNavigator
        title="Tasks"
        action={on.has('headerAction')
          ? (
            <Button
              size="sm"
              variant={allApproved ? 'secondary' : 'primary'}
              leftIcon={allApproved ? <RotateCcw /> : <Check />}
              onClick={toggleAll}
            >
              {allApproved ? 'Revoke all' : 'Approve all'}
            </Button>
          )
          : undefined}
        progress={on.has('progress') ? { value: approved.size, total: NAV_IDS.length } : undefined}
        groups={groups}
        showChecks={on.has('checkTick')}
        footer={on.has('advance')
          ? <Button className="w-full" rightIcon={<ArrowRight />} disabled={!allApproved}>Continue to Validate</Button>
          : undefined}
      />
    </div>
  );
}

interface Round { passNo: number; verdict: 'clean' | 'revised'; findings: Finding[] }

/** First run surfaces a mixed-severity set (verdict `revised`); a re-run comes back clean. */
function makeRound(passNo: number): Round {
  if (passNo > 1) return { passNo, verdict: 'clean', findings: [] };
  return {
    passNo,
    verdict: 'revised',
    findings: [
      { severity: 'critical', category: 'path-existence', claim: 'Task references a file that does not exist' },
      { severity: 'high', category: 'signature-match', claim: 'Signature drift in the interpret route' },
      { severity: 'high', category: 'cross-task', claim: 'Task B3 depends on B1 output not yet produced' },
      { severity: 'medium', category: 'test-harness', claim: 'Missing test coverage for the disabled path' },
      { severity: 'medium', category: 'sequencing', claim: 'Verify step precedes the implement step' },
      { severity: 'medium', category: 'spec-coverage', claim: 'Gaps between spec requirements and plan tasks' },
      { severity: 'medium', category: 'granularity', claim: 'Task A2 bundles two independent changes' },
      { severity: 'low', category: 'placeholder', claim: 'TODO placeholder left in a verify command' },
    ],
  };
}

/**
 * The Card-list panel — a generic run/result container (header action · scrollable card
 * list · gated advance footer). This demo drives the whole audit-run lifecycle:
 *   empty → click Run audit → "Pass N running…" → a pass card lands (click to select) →
 *   the first pass is revised (advance stays locked) → Re-run → a clean pass unlocks
 *   "Continue to Execute".
 */
function CardListDemo({ on }: { on: ReadonlySet<string> }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [auditing, setAuditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canAdvance = rounds.some((r) => r.verdict === 'clean');

  const runAudit = () => {
    if (auditing) return;
    setAuditing(true);
    timer.current = setTimeout(() => {
      setRounds((prev) => {
        const passNo = prev.length + 1;
        setSelected(passNo);
        return [...prev, makeRound(passNo)];
      });
      setAuditing(false);
    }, 900);
  };

  return (
    <div className="max-w-md">
      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <CardTitle>Audit rounds</CardTitle>
          {on.has('headerAction') ? (
            <Button size="sm" onClick={runAudit} loading={auditing} leftIcon={<Shield />}>
              {auditing ? 'Auditing…' : rounds.length > 0 ? 'Re-run' : 'Run audit'}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto !py-4">
          {!auditing && rounds.length === 0 ? (
            <div className="flex items-start gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3">
              <Shield className="mt-0.5 size-4 shrink-0 text-ink-faint" />
              <p className="text-xs leading-relaxed text-ink-soft">Run an audit to check sequencing, coverage and TDD gaps.</p>
            </div>
          ) : null}
          {auditing ? (
            <div className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface-2/60 px-3 py-2.5">
              <Loader2 className="size-4 animate-spin text-accent" />
              <span className="text-sm font-medium text-ink">Pass {rounds.length + 1}</span>
              <span className="text-xs text-ink-faint">Running…</span>
            </div>
          ) : null}
          {[...rounds].reverse().map((r) => (
            <AuditRoundCard
              key={r.passNo}
              passNo={r.passNo}
              verdict={r.verdict}
              findings={r.findings}
              active={selected === r.passNo}
              onClick={() => setSelected(r.passNo)}
            />
          ))}
        </CardContent>
        {on.has('advance') ? (
          <CardFooter className="flex-col !items-stretch gap-2">
            <StageAdvance onClick={() => {}} label="Continue to Execute" disabled={!canAdvance} gate={!canAdvance} />
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}

/* ── Run list (Loops › Activity) ─────────────────────────────────────────── */

interface RunRow { id: string; status: 'changed' | 'unchanged' | 'failed'; name: string; when: string; dur: string; hash: string }
const RUN_ROWS: RunRow[] = [
  { id: '1', status: 'changed', name: 'Maintenance Sanity', when: '14 Jul 2026, 21:04', dur: '16m 7s', hash: 'a95e461d' },
  { id: '2', status: 'changed', name: 'Maintenance Sanity', when: '01 Jul 2026, 10:35', dur: '14m 59s', hash: 'bac1603c' },
  { id: '3', status: 'unchanged', name: 'Maintenance Sanity', when: '01 Jul 2026, 10:12', dur: '14m 9s', hash: '0cf25ed5' },
  { id: '4', status: 'unchanged', name: 'Maintenance Sanity', when: '01 Jul 2026, 10:00', dur: '8m 36s', hash: '219b43bd' },
  { id: '5', status: 'failed', name: 'Maintenance Sanity', when: '01 Jul 2026, 09:36', dur: '1s', hash: 'ac5eb0db' },
];
const RUN_BADGE: Record<RunRow['status'], { label: string; variant: 'sage' | 'neutral' | 'rose' }> = {
  changed: { label: 'Changed', variant: 'sage' },
  unchanged: { label: 'No changes', variant: 'neutral' },
  failed: { label: 'Failed', variant: 'rose' },
};

/** Interactive Run-list panel: a Loop/Status filter toolbar (inside the card) over a
 *  scrollable list of run cards. Click a run to select it; the Status select filters. */
function RunListDemo({ on }: { on: ReadonlySet<string> }) {
  const [selected, setSelected] = useState('1');
  const [status, setStatus] = useState('all');
  const rows = status === 'all' ? RUN_ROWS : RUN_ROWS.filter((r) => r.status === status);
  return (
    <div className="max-w-md">
      <RecordList
        toolbar={on.has('filters') ? (
          <div className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label as="span">Loop</Label>
              <Select defaultValue="all">
                <SelectTrigger className="w-full" aria-label="Filter by loop"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All loops</SelectItem><SelectItem value="maint">Maintenance Sanity</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label as="span">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full" aria-label="Filter by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="changed">Changed</SelectItem>
                  <SelectItem value="unchanged">No changes</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : undefined}
        countLabel={`Runs (${rows.length})`}
      >
        {rows.map((r) => (
          <RecordCard
            key={r.id}
            selected={r.id === selected}
            onClick={() => setSelected(r.id)}
            chips={on.has('statusBadge') ? <Badge size="sm" variant={RUN_BADGE[r.status].variant}>{RUN_BADGE[r.status].label}</Badge> : undefined}
            trailing={on.has('runId') ? <Mono className="!text-[0.6875rem] text-ink-faint">{r.hash}</Mono> : undefined}
            title={r.name}
            detail={<Micro className="text-ink-faint">{r.when} · {r.dur}</Micro>}
          />
        ))}
      </RecordList>
    </div>
  );
}

/* ── Node list (Journal › Nodes) ─────────────────────────────────────────── */

const NODE_CATEGORIES = ['Decision', 'Design', 'Behavior', 'Process', 'Knowledge', 'Style'] as const;
const NODE_CAT_STYLE: Record<string, string> = {
  Decision: 'bg-amber-tint text-[var(--amber)]',
  Design: 'bg-[var(--frost)] text-[var(--steel)]',
  Behavior: 'bg-accent-tint text-accent-deep',
  Process: 'bg-sage-tint text-[var(--sage-deep)]',
  Knowledge: 'bg-surface-2 text-ink-soft',
  Style: 'bg-surface-2 text-ink-soft',
};
interface NodeRow { id: string; type: (typeof NODE_CATEGORIES)[number]; title: string; tags: string[] }
const NODE_ROWS: NodeRow[] = [
  { id: '0001', type: 'Decision', title: 'Guard provider identity at the data layer, not the routes', tags: ['cost-accounting', 'dispatch', 'parser-drops', 'ui', 'config'] },
  { id: '0002', type: 'Decision', title: 'Guard enum narrowing at the data layer, not the routes', tags: ['cross-tier', 'dx', 'worktrees', 'config', 'recall'] },
  { id: '0003', type: 'Design', title: 'Treat a derived signal in the journal graph store as part of the control path', tags: ['completion-gating', 'sandbox', 'architecture'] },
  { id: '0004', type: 'Design', title: 'Make the install writers the single canonical read path', tags: ['schema-version', 'design-system', 'layout'] },
  { id: '0005', type: 'Decision', title: 'Prefer a one-owner serialization lock over hand-rolled telemetry attribution', tags: ['cross-tier', 'hydration', 'quality', 'graph'] },
  { id: '0006', type: 'Design', title: 'Strip legacy paths out of the journal viewer', tags: ['refactor', 'journal'] },
];

/** Interactive Node-list panel (journal Nodes index): record action · search · category
 *  chips · status + sort · node cards with tag chips. Search + chips + sort all filter live. */
function NodeListDemo({ on }: { on: ReadonlySet<string> }) {
  const [selected, setSelected] = useState('0001');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [desc, setDesc] = useState(false);
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = NODE_ROWS.filter((n) => {
      if (cat !== 'All' && n.type !== cat) return false;
      if (!ql) return true;
      return n.title.toLowerCase().includes(ql) || n.tags.some((t) => t.toLowerCase().includes(ql));
    });
    out = [...out].sort((a, b) => a.id.localeCompare(b.id));
    if (desc) out.reverse();
    return out;
  }, [q, cat, desc]);

  return (
    <div className="max-w-md">
      <RecordList
        header={
          <>
            <CardTitle>Nodes</CardTitle>
            {on.has('recordAction') ? <Button size="sm" leftIcon={<PencilLine />}>Record a learning</Button> : null}
          </>
        }
        toolbar={
          <div className="flex flex-col gap-2">
            {on.has('search') ? (
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search title or tags…"
                  aria-label="Search nodes"
                  className="w-full rounded-[var(--r-sm)] border border-line bg-surface-2 py-1.5 pl-8 pr-2 text-sm text-ink outline-none focus:border-accent"
                />
              </div>
            ) : null}
            {on.has('categoryChips') ? (
              <div className="flex flex-wrap items-center gap-1">
                {(['All', ...NODE_CATEGORIES] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCat(c)}
                    aria-pressed={cat === c}
                    className={cn(
                      'rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[11px]',
                      cat === c
                        ? c === 'All' ? 'border-accent bg-accent-tint text-accent-deep' : cn('border-transparent', NODE_CAT_STYLE[c])
                        : 'border-line text-ink-soft hover:border-line-strong',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
            {on.has('statusSort') ? (
              <div className="flex items-center justify-between gap-2">
                <span className="px-0.5 text-[11px] text-ink-faint">Status: <span className="font-medium capitalize text-ink-soft">Adopted</span></span>
                <button
                  type="button"
                  onClick={() => setDesc((d) => !d)}
                  className="shrink-0 rounded-[var(--r-sm)] border border-line px-1.5 py-0.5 text-[11px] text-ink-soft hover:border-line-strong"
                >
                  sort {desc ? '↓' : '↑'}
                </button>
              </div>
            ) : null}
          </div>
        }
      >
        {rows.map((n) => (
          <RecordCard
            key={n.id}
            selected={selected === n.id}
            onClick={() => setSelected(n.id)}
            chips={
              <>
                <span className="font-mono text-[11px] text-ink-faint">{n.id}</span>
                <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', NODE_CAT_STYLE[n.type])}>{n.type}</span>
                <StatusBadge status="adopted" />
              </>
            }
            title={n.title}
            detail={on.has('tags') && n.tags.length ? (
              <span className="flex flex-wrap gap-1">
                {n.tags.map((t) => (
                  <span key={t} className="rounded-[var(--r-sm)] bg-surface-2 px-1 py-0.5 text-[10px] text-ink-soft">{t}</span>
                ))}
              </span>
            ) : undefined}
          />
        ))}
      </RecordList>
    </div>
  );
}

/** Per-pattern renders for the Right-panel (the section BELOW the note), keyed by the id in
 *  RIGHT_PANEL_VARIANTS. `on` is the set of governed affordances switched on. */
const RENDERS: Record<string, (on: ReadonlySet<string>) => ReactNode> = {
  navigator: (on) => <NavigatorDemo on={on} />,

  // The generic Card-list panel (Plan Validate / Review / Spec Finalize): header action ·
  // scrollable card list · gated advance footer. Demoed via the audit-run lifecycle.
  cardList: (on) => <CardListDemo on={on} />,

  // The filterable Run list (Loops › Activity): filter toolbar + run cards.
  runList: (on) => <RunListDemo on={on} />,

  // The journal Node index (Journal › Nodes): record action + search + chips + node cards.
  nodeList: (on) => <NodeListDemo on={on} />,
};

/** Renders one Right-panel pattern (a sub-page), by id, honouring its affordances. */
export function RightPanelVariant({ id, enabled }: { id: string; enabled?: ReadonlySet<string> }) {
  const render = RENDERS[id];
  const meta = RIGHT_PANEL_VARIANTS.find((v) => v.id === id);
  const on = enabled ?? defaultEnabledAffordances(meta ?? {});
  return <>{render ? render(on) : null}</>;
}

/** Overview (the slot's default page) — every right-panel pattern stacked, in meta order. */
export function RightPanelPreview() {
  return (
    <div className="flex flex-col gap-8">
      {RIGHT_PANEL_VARIANTS.map((v) => (
        <div key={v.id} className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{v.label}</p>
          {RENDERS[v.id]?.(defaultEnabledAffordances(v))}
        </div>
      ))}
    </div>
  );
}
