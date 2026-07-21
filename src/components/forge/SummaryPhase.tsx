'use client';

import {
  Clock,
  DollarSign,
  Zap,
  Shield,
  GitCommit,
  BookOpen,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@/components/ui';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { StatCard, StatCardGrid } from '@/components/patterns/cards';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell } from '@/components/patterns/stage-shell';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format-date';
import { STAGE_LABEL } from '@/projects/stage-lifecycle';
import type { StageKind } from '@/db/enums';
import type { ProjectSummary } from '@/projects/project-summary';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  // floor, not round: 95 min is 1h 35m, not 2h 35m (round would carry the hour AND
  // still show the 35 remainder).
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

/** Compact per-activity duration, matching the live overlay ("0.4s", "2m 48s"). */
function formatDur(ms: number): string {
  if (ms < 950) return `${Math.max(0, Math.round(ms / 100) / 10)}s`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function stageDuration(startedAt: string | Date | null, completedAt: string | Date | null): string {
  if (!startedAt || !completedAt) return '—';
  const start = typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt.getTime();
  const end = typeof completedAt === 'string' ? new Date(completedAt).getTime() : completedAt.getTime();
  return formatDuration(end - start);
}

const STAGE_ORDER = ['exploration', 'spec', 'plan', 'execute', 'review', 'journal'];

const SUMMARY_NOTE = `### Summary — your project at a glance

- **Timeline** — how long each stage took
- **Cost** — MMA spend and savings
- **Quality** — audit rounds and findings
- **Delivery** — tasks committed to code`;

export interface SummaryPhaseProps {
  summary: ProjectSummary;
  projectId: string;
  readOnly?: boolean;
  onMarkComplete?: () => void;
  completing?: boolean;
}

export function SummaryPhase({ summary, readOnly, onMarkComplete, completing }: SummaryPhaseProps) {
  const orderedStages = STAGE_ORDER
    .map((kind) => summary.timeline.stages.find((s) => s.kind === kind))
    .filter(Boolean) as typeof summary.timeline.stages;

  // Total is the sum of active stage work, so it stays coherent with the per-stage rows
  // (they add up) and — like each stage — excludes idle pauses when a project is left
  // for hours or days between stages.
  const totalProjectMs = orderedStages.reduce((sum, s) => sum + (s.activeMs ?? 0), 0);

  return (
    <StageShell
      // Six stacked cards, so the COLUMN scrolls past them — the same `outer` every other
      // card-stacking page declares (usage, team settings, profile, run history). It used
      // to sit on the default `inner`, which reserves the scroll for a single item that
      // scrolls itself, and then hand-rolled `overflow-y-auto` on the grid to compensate —
      // a scroller the column knew nothing about, so the panel never actually scrolled and
      // the cards' hover bloom lost the clearance `scroll-pane` provides.
      scroll="outer"
      note={<RailNote icon={<BookOpen />}>{SUMMARY_NOTE}</RailNote>}
      navigator={
        <>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <div className="flex min-w-0 items-center gap-2">
              <CardTitle>Activity</CardTitle>
              {summary.events.length > 0 ? <Badge variant="neutral" size="sm">{summary.events.length}</Badge> : null}
            </div>
            {summary.completedAt ? <Badge variant="sage" size="sm">Completed</Badge> : null}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto !py-2">
            {summary.events.length === 0 ? (
              <p className="py-8 text-center text-xs text-ink-faint">No activity recorded yet.</p>
            ) : (
              summary.events.map((e, i) => (
                <div key={i} className="grid grid-cols-[2.75rem_1fr_3.5rem] items-start gap-x-2 border-b border-line/40 py-1.5 last:border-0">
                  {/* col 1 — time (fixed) */}
                  <span className="mt-px font-mono text-[10px] tabular-nums text-ink-faint">{formatTime(new Date(e.createdAt))}</span>
                  {/* col 2 — detail (with status icon); wraps within its own column */}
                  <span className="flex min-w-0 items-start gap-1.5">
                    {e.kind === 'error'
                      ? <AlertTriangle className="mt-0.5 size-3 shrink-0 text-[var(--danger,#c0492f)]" />
                      : <Check className="mt-0.5 size-3 shrink-0 text-[var(--sage)]" />}
                    <span className="flex min-w-0 items-start gap-1.5">
                      <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: e.actorTint }} />
                      <span className="shrink-0 text-xs font-medium text-ink-soft">{e.actorName}</span>
                      <span className={cn('min-w-0 break-words text-[13px] leading-snug', e.kind === 'error' ? 'text-[var(--danger,#c0492f)]' : 'text-ink')}>{e.label}</span>
                    </span>
                  </span>
                  {/* col 3 — duration (fixed, always reserved so col 2 can't eat it) */}
                  <span className="mt-px text-right font-mono text-[10px] tabular-nums text-ink-faint">{e.durationMs != null ? formatDur(e.durationMs) : ''}</span>
                </div>
              ))
            )}
          </CardContent>
          <div className="mt-auto shrink-0 border-t border-line px-5 py-4">
            {/* Completing the project is the last and most irreversible transition in the
                flow, so it wears the padlock like every other gated stage advance — and once
                it's done it stays the SAME control, spent and disabled. It used to become a
                bespoke green "Project complete" banner, which is a shape the advance slot
                doesn't declare. */}
            <StageAdvance
              label={summary.completedAt ? 'Completed' : completing ? 'Completing…' : 'Mark complete'}
              gate
              busy={completing}
              disabled={readOnly || Boolean(summary.completedAt)}
              onClick={onMarkComplete}
            />
          </div>
        </Card>
        </>
      }
    >
      <StatCardGrid>
        <StatCard
          icon={<Clock />}
          title="Timeline"
          rows={[
            ...orderedStages.map((s) => ({
              label: STAGE_LABEL[s.kind as StageKind] ?? s.kind,
              value: s.activeMs > 0 ? formatDuration(s.activeMs) : stageDuration(s.startedAt, s.completedAt),
            })),
          ]}
          footer={{ label: 'Total', value: totalProjectMs > 0 ? formatDuration(totalProjectMs) : '—' }}
        />

        {(() => {
          // What you actually paid is `totalUsd` — full stop. `savedUsd` is a
          // counterfactual: the extra it WOULD have cost to run every task on the main
          // tier. So the hypothetical main-only cost is spend + saved, and the saving is
          // the gap between them — never subtracted from what you really spent.
          const spend = summary.cost.totalUsd;
          const mainOnly = spend + summary.cost.savedUsd;
          const pct = mainOnly > 0 ? Math.round((summary.cost.savedUsd / mainOnly) * 100) : 0;
          return (
            <StatCard
              icon={<DollarSign />}
              title="Cost"
              rows={[
                { label: 'MMA spend', value: formatUsd(spend) },
                { label: 'Main tier only (est.)', value: formatUsd(mainOnly) },
              ]}
              footer={{
                label: 'Saved',
                value: pct > 0 ? `${formatUsd(summary.cost.savedUsd)} (${pct}%)` : formatUsd(summary.cost.savedUsd),
              }}
            />
          );
        })()}

        <StatCard
          icon={<Zap />}
          title="Effort"
          rows={[
            { label: 'MMA calls', value: String(summary.effort.totalCalls) },
            { label: 'Input tokens', value: formatTokens(summary.effort.totalInputTokens) },
            { label: 'Output tokens', value: formatTokens(summary.effort.totalOutputTokens) },
            { label: 'Compute time', value: formatDuration(summary.effort.totalDurationMs) },
          ]}
          footer={{
            label: 'Total tokens',
            value: formatTokens(summary.effort.totalInputTokens + summary.effort.totalOutputTokens),
          }}
        />

        <StatCard
          icon={<Shield />}
          title="Quality"
          rows={[
            { label: 'Spec version', value: `v${summary.quality.specVersion}` },
            { label: 'Plan version', value: `v${summary.quality.planVersion}` },
          ]}
          footer={{ label: 'Audit passes', value: String(summary.quality.auditPasses.length) }}
        />

        <StatCard
          icon={<GitCommit />}
          title="Delivery"
          rows={[
            { label: 'Total tasks', value: String(summary.delivery.totalTasks) },
            { label: 'Approved', value: String(summary.delivery.approved) },
          ]}
          footer={{
            label: 'Approval rate',
            value: summary.delivery.totalTasks > 0
              ? `${Math.round((summary.delivery.approved / summary.delivery.totalTasks) * 100)}%`
              : '—',
          }}
        />

        <StatCard
          icon={<BookOpen />}
          title="Knowledge"
          rows={[
            ...Object.entries(summary.knowledge.byType).map(([cat, count]) => ({
              label: cat,
              value: String(count),
            })),
          ]}
          footer={{ label: 'Learnings recorded', value: String(summary.knowledge.recorded) }}
        />
      </StatCardGrid>
    </StageShell>
  );
}
