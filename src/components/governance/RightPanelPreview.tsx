'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, GitBranch, Loader2, RotateCcw, Shield } from 'lucide-react';
import { Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui';
import { StageNavigator, type NavGroup } from '@/components/patterns/stage-navigator';
import { AuditRoundCard, type Finding } from '@/components/patterns/findings';
import { StageAdvance } from '@/components/forge/StageAdvance';
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

/** Per-pattern renders for the Right-panel (the section BELOW the note), keyed by the id in
 *  RIGHT_PANEL_VARIANTS. `on` is the set of governed affordances switched on. */
const RENDERS: Record<string, (on: ReadonlySet<string>) => ReactNode> = {
  navigator: (on) => <NavigatorDemo on={on} />,

  // The generic Card-list panel (Plan Validate / Review / Spec Finalize): header action ·
  // scrollable card list · gated advance footer. Demoed via the audit-run lifecycle.
  cardList: (on) => <CardListDemo on={on} />,
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
