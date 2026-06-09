'use client';

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

export function AgentRail({ tasks }: { tasks: RailTask[] }) {
  const active = tasks.filter((t) => t.status !== 'draft');
  return (
    <section aria-label="Agent activity" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink">Agent rail</h2>
      <div
        aria-live="polite"
        aria-busy={active.some((t) => statusLabel(t).tone === 'run')}
        className="flex flex-col gap-2"
        data-testid="agent-rail"
      >
        {active.length === 0 ? (
          <p className="text-xs text-ink-muted">No tasks dispatched yet.</p>
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
                <span
                  className={cn(
                    'mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    s.tone === 'run' && 'bg-amber-100 text-amber-900',
                    s.tone === 'done' && 'bg-emerald-100 text-emerald-900',
                    s.tone === 'fail' && 'bg-red-100 text-red-900',
                    s.tone === 'idle' && 'bg-surface text-ink-muted',
                  )}
                >
                  {locked ? '🔒 ' : ''}
                  {s.text}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">
                    {ROUTE_LABEL[t.kind] ?? t.kind}
                  </p>
                  <p className="truncate text-xs text-ink-muted">{t.prompt}</p>
                  {s.tone === 'run' && t.headline ? (
                    <p className="mt-1 truncate text-[11px] text-ink-muted">{t.headline}</p>
                  ) : null}
                  {s.tone === 'fail' && t.error ? (
                    <p className="mt-1 text-[11px] text-red-700">{t.error.message}</p>
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
