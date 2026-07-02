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
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { formatDate } from '@/lib/format-date';
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

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function stageDuration(startedAt: Date | null, completedAt: Date | null): string {
  if (!startedAt || !completedAt) return '—';
  const ms = completedAt.getTime() - startedAt.getTime();
  return formatDuration(ms);
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

export function SummaryPhase({ summary, projectId, readOnly, onMarkComplete, completing }: SummaryPhaseProps) {
  const orderedStages = STAGE_ORDER
    .map((kind) => summary.timeline.stages.find((s) => s.kind === kind))
    .filter(Boolean) as typeof summary.timeline.stages;

  const totalProjectMs = (() => {
    const first = orderedStages.find((s) => s.startedAt);
    const last = [...orderedStages].reverse().find((s) => s.completedAt);
    if (!first?.startedAt || !last?.completedAt) return 0;
    return last.completedAt.getTime() - first.startedAt.getTime();
  })();

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* LEFT — stat cards (2/3) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
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
          <StatRow
            label="Findings"
            value={String(summary.quality.auditPasses.reduce((sum, p) => sum + p.findingsCount, 0))}
          />
        </StatCard>

        <StatCard icon={GitCommit} title="Delivery">
          <StatRow label="Total tasks" value={String(summary.delivery.totalTasks)} />
          <StatRow label="Committed" value={String(summary.delivery.committed)} />
          {summary.delivery.failed > 0 ? (
            <StatRow label="Failed" value={String(summary.delivery.failed)} />
          ) : null}
          {summary.delivery.skipped > 0 ? (
            <StatRow label="Skipped" value={String(summary.delivery.skipped)} />
          ) : null}
        </StatCard>

        <StatCard icon={BookOpen} title="Knowledge">
          <StatRow label="Learnings recorded" value={String(summary.knowledge.recorded)} />
          {Object.entries(summary.knowledge.byCategory).map(([cat, count]) => (
            <StatRow key={cat} label={cat} value={String(count)} />
          ))}
        </StatCard>
      </div>

      {/* RIGHT — note + mark complete (1/3) */}
      <aside className="flex min-h-0 flex-col gap-4">
        <RailNote icon={<BookOpen />}>{SUMMARY_NOTE}</RailNote>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>{summary.projectName}</CardTitle>
            {summary.completedAt ? (
              <Badge variant="sage" size="sm">Completed</Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-ink-soft">
              Started {formatDate(summary.createdAt)}
              {summary.completedAt ? (
                <> · Completed {formatDate(summary.completedAt)}</>
              ) : null}
            </div>
          </CardContent>
          <div className="mt-auto border-t border-line px-5 py-4">
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
      </aside>
    </div>
  );
}
