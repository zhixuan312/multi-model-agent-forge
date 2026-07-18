'use client';

import {
  Clock,
  DollarSign,
  Zap,
  Shield,
  GitCommit,
  BookOpen,
  Check,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format-date';
import type { ProjectSummary } from '@/projects/project-summary';

function StatCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-accent" />
          <CardTitle>{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
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

const STAGE_LABELS: Record<string, string> = {
  exploration: 'Explore',
  spec: 'Spec',
  plan: 'Plan',
  execute: 'Execute',
  review: 'Review',
  journal: 'Journal',
};

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

  const totalProjectMs = (() => {
    const first = orderedStages.find((s) => s.startedAt);
    const last = [...orderedStages].reverse().find((s) => s.completedAt);
    if (!first?.startedAt || !last?.completedAt) return 0;
    const start = new Date(first.startedAt).getTime();
    const end = new Date(last.completedAt).getTime();
    return end - start;
  })();

  return (
    <StatusDashboard
      primary={
      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto forge-scroll sm:grid-cols-2">
        <StatCard icon={Clock} title="Timeline">
          {orderedStages.map((s) => (
            <StatRow key={s.kind} label={STAGE_LABELS[s.kind] ?? s.kind} value={stageDuration(s.startedAt, s.completedAt)} />
          ))}
          <div className="mt-2 border-t border-line pt-2">
            <StatRow label="Total" value={totalProjectMs > 0 ? formatDuration(totalProjectMs) : '—'} />
          </div>
        </StatCard>

        <StatCard icon={DollarSign} title="Cost">
          <StatRow label="Total MMA spend" value={formatUsd(summary.cost.totalUsd)} />
          <StatRow label="Saved vs main tier" value={formatUsd(summary.cost.savedUsd)} />
        </StatCard>

        <StatCard icon={Zap} title="Effort">
          <StatRow label="MMA calls" value={String(summary.effort.totalCalls)} />
          <StatRow label="Input tokens" value={formatTokens(summary.effort.totalInputTokens)} />
          <StatRow label="Output tokens" value={formatTokens(summary.effort.totalOutputTokens)} />
          <StatRow label="Compute time" value={formatDuration(summary.effort.totalDurationMs)} />
        </StatCard>

        <StatCard icon={Shield} title="Quality">
          <StatRow label="Spec version" value={`v${summary.quality.specVersion}`} />
          <StatRow label="Plan version" value={`v${summary.quality.planVersion}`} />
          <StatRow label="Audit passes" value={String(summary.quality.auditPasses.length)} />
        </StatCard>

        <StatCard icon={GitCommit} title="Delivery">
          <StatRow label="Total tasks" value={String(summary.delivery.totalTasks)} />
          <StatRow label="Approved" value={String(summary.delivery.approved)} />
        </StatCard>

        <StatCard icon={BookOpen} title="Knowledge">
          <StatRow label="Learnings recorded" value={String(summary.knowledge.recorded)} />
          {Object.entries(summary.knowledge.byType).map(([cat, count]) => (
            <StatRow key={cat} label={cat} value={String(count)} />
          ))}
        </StatCard>
      </div>

      }
      aside={
        <>
        <RailNote icon={<BookOpen />}>{SUMMARY_NOTE}</RailNote>
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
            {summary.completedAt ? (
              <div className="flex items-center justify-center gap-2 rounded-[var(--r)] bg-sage-tint px-4 py-2.5 text-sm font-medium text-[var(--sage-deep)]">
                <Check className="size-4" />
                Project complete
              </div>
            ) : (
              <button
                type="button"
                onClick={onMarkComplete}
                disabled={readOnly || completing}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--r)] bg-ink px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink/90 disabled:pointer-events-none disabled:bg-ink/30 disabled:text-white/50"
              >
                {completing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {completing ? 'Completing...' : 'Mark complete'}
              </button>
            )}
          </div>
        </Card>
        </>
      }
    />
  );
}
