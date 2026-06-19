'use client';

import { Lock, Radar } from 'lucide-react';
import { Badge, EmptyState, type BadgeProps } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { RailTask } from '@/hooks/useProjectEvents';

/**
 * `AgentRail` (Spec 5 flow D) — the live per-task status rail. Each row renders
 * the task's route + prompt and its live state derived from the joined
 * `mma_batch.status` (queued → running w/ headline → recorded/failed). A
 * `recorded` task is LOCKED. The whole rail is an `aria-live="polite"` region so
 * each SSE-driven transition is announced to assistive tech (F19).
 */

const ROUTE_LABEL: Record<string, string> = {
  investigate: 'Investigate',
  research: 'Research',
  journal: 'Journal recall',
};

function statusLabel(t: RailTask): { text: string; tone: 'idle' | 'run' | 'done' | 'fail' } {
  if (t.status === 'draft') return { text: 'draft', tone: 'idle' };
  if (t.batchStatus === 'failed') return { text: 'failed', tone: 'fail' };
  if (t.status === 'recorded' || t.batchStatus === 'done') return { text: 'recorded', tone: 'done' };
  return { text: 'running', tone: 'run' };
}

const TONE_VARIANT: Record<'idle' | 'run' | 'done' | 'fail', BadgeProps['variant']> = {
  idle: 'neutral',
  run: 'amber',
  done: 'sage',
  fail: 'rose',
};

export function AgentRail({ tasks }: { tasks: RailTask[] }) {
  const active = tasks.filter((t) => t.status !== 'draft');
  return (
    <section aria-label="Agent activity" className="flex min-h-0 flex-1 flex-col">
      <div
        aria-live="polite"
        aria-busy={active.some((t) => statusLabel(t).tone === 'run')}
        className="flex min-h-0 flex-1 flex-col gap-2"
        data-testid="agent-rail"
      >
        {active.length === 0 ? (
          <EmptyState
            icon={<Radar />}
            title="No tasks dispatched yet."
            description="Run the fan-out to watch each agent report here live."
          />
        ) : (
          active.map((t) => {
            const s = statusLabel(t);
            const locked = t.status === 'recorded';
            return (
              <div
                key={t.id}
                data-task-id={t.id}
                data-status={s.text}
                className={cn(
                  'flex items-start gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3',
                  locked && 'opacity-90',
                )}
              >
                <Badge variant={TONE_VARIANT[s.tone]} size="sm" className="mt-0.5 shrink-0">
                  {locked ? <Lock aria-hidden="true" className="size-3" /> : null}
                  {s.text}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">
                    {ROUTE_LABEL[t.kind] ?? t.kind}
                  </p>
                  <p className="truncate text-xs text-ink-soft">{t.prompt}</p>
                  {s.tone === 'run' && t.headline && !/^running\.{0,3}$/i.test(t.headline.trim()) ? (
                    <p className="mt-1 truncate text-[11px] text-ink-soft">{t.headline}</p>
                  ) : null}
                  {s.tone === 'fail' && t.error ? (
                    <p className="mt-1 text-[11px] text-[var(--rose)]">{t.error.message}</p>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
