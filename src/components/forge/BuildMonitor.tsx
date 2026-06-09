'use client';

import { useEffect, useState } from 'react';
import type { ProjectEvent } from '@/sse/event-bus';
import type { BuildView, PlanTaskView } from '@/build/build-core';
import { Markdown } from '@/components/forge/Markdown';

/**
 * BuildMonitor (Spec 7 §UI / build.html) — the live build monitor. Three stacked
 * cards (Plan · Execute · Review) fed by the RSC first paint and patched live by
 * the per-project SSE bus. Status is conveyed by TEXT LABEL + ICON (never color
 * alone); the live transition region is an ARIA live region (`role="status"`);
 * the current task carries `aria-current="step"`.
 *
 * Cost is observability-only (the running-spend chip) — it NEVER gates the
 * pipeline.
 */

interface ReviewState {
  repo: string;
  verdict: string;
  findingsCount: number;
}

const STATUS_META: Record<string, { label: string; icon: string; tint: string }> = {
  queued: { label: 'queued', icon: '◦', tint: 'text-ink-faint' },
  executing: { label: 'executing', icon: '⟳', tint: 'text-amber-600' },
  verifying: { label: 'verifying', icon: '◎', tint: 'text-amber-600' },
  fixing: { label: 'fixing', icon: '⟳', tint: 'text-rose-600' },
  committed: { label: 'committed', icon: '✓', tint: 'text-emerald-700' },
  skipped: { label: 'skipped', icon: '–', tint: 'text-ink-faint' },
  failed: { label: 'failed', icon: '✕', tint: 'text-rose-600' },
};

export function BuildMonitor({ projectId, initial }: { projectId: string; initial: BuildView }) {
  const [tasks, setTasks] = useState<PlanTaskView[]>(initial.tasks);
  const [auditPasses, setAuditPasses] = useState(initial.auditPasses);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<ReviewState[]>([]);
  const [cost, setCost] = useState<{ total: number; byRoute: { audit: number; executePlan: number; review: number } }>({
    total: 0,
    byRoute: { audit: 0, executePlan: 0, review: 0 },
  });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/events`);
    es.onmessage = (msg) => {
      let e: ProjectEvent;
      try {
        e = JSON.parse(msg.data) as ProjectEvent;
      } catch {
        return;
      }
      applyEvent(e);
    };
    return () => es.close();

    function applyEvent(e: ProjectEvent): void {
      switch (e.type) {
        case 'audit.pass':
          setAuditPasses((p) => [...p, { passNo: e.pass, findingsCount: e.findingsCount, verdict: e.verdict }]);
          break;
        case 'task.executing':
          setCurrentTaskId(e.taskId);
          patch(e.taskId, (t) => ({ ...t, status: 'executing', branch: e.branch }));
          break;
        case 'task.verifying':
          patch(e.taskId, (t) => ({ ...t, status: 'verifying' }));
          break;
        case 'task.fixing':
          patch(e.taskId, (t) => ({ ...t, status: 'fixing', fixNote: e.note }));
          break;
        case 'task.fixed':
          patch(e.taskId, (t) => ({ ...t, fixNote: e.note }));
          break;
        case 'task.committed':
          patch(e.taskId, (t) => ({ ...t, status: 'committed', commitSha: e.commitSha }));
          break;
        case 'build.task_failed':
          patch(e.taskId, (t) => ({ ...t, status: 'failed' }));
          break;
        case 'review.done':
          setReviews((r) => [...r.filter((x) => x.repo !== e.repo), { repo: e.repo, verdict: e.verdict, findingsCount: e.findingsCount }]);
          break;
        case 'execute.notice':
          setNotice(`A teammate is executing ${e.repo}.`);
          break;
        case 'cost.tick':
          setCost((c) => ({
            total: c.total + e.runCostUsd,
            byRoute: {
              audit: c.byRoute.audit + e.byRoute.audit,
              executePlan: c.byRoute.executePlan + e.byRoute.executePlan,
              review: c.byRoute.review + e.byRoute.review,
            },
          }));
          break;
        default:
          break;
      }
    }
    function patch(id: string, fn: (t: PlanTaskView) => PlanTaskView): void {
      setTasks((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
    }
  }, [projectId]);

  return (
    <div className="flex flex-col gap-5">
      {/* Header — running spend chip (observability only). */}
      <header className="flex items-center justify-between">
        <h2 className="font-serif text-lg">Build pipeline</h2>
        <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs text-ink-faint" title="Running spend — observability only, no cost cap">
          ${cost.total.toFixed(4)} · audit ${cost.byRoute.audit.toFixed(3)} · exec ${cost.byRoute.executePlan.toFixed(3)} · review ${cost.byRoute.review.toFixed(3)}
        </span>
      </header>

      {notice && (
        <div role="status" aria-live="polite" className="rounded-[var(--r-md)] border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {notice}
        </div>
      )}

      {/* Plan card */}
      <section className="rounded-[var(--r-lg)] border border-line bg-surface-1 p-4">
        <h3 className="mb-2 font-serif text-base">Plan</h3>
        <p className="mb-3 text-xs text-ink-faint">
          Write targets: <span className="text-ink">{initial.writeTargets.join(', ') || '—'}</span>
          {initial.readOnly.length > 0 && (
            <>
              {' · '}Read-only: <span className="text-ink">{initial.readOnly.join(', ')}</span>
            </>
          )}
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {auditPasses.map((p) => (
            <span
              key={p.passNo}
              className={`rounded-full border px-2 py-0.5 text-xs ${p.verdict === 'clean' ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'}`}
            >
              pass {p.passNo}: {p.findingsCount} finding{p.findingsCount === 1 ? '' : 's'} {p.verdict === 'clean' ? '✓ clean' : '⟳ revised'}
            </span>
          ))}
        </div>
        {initial.planMd ? (
          <details>
            <summary className="cursor-pointer text-xs text-ink-faint">Plan v{initial.planVersion} (markdown)</summary>
            <div className="mt-2 max-h-80 overflow-auto rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
              <Markdown>{initial.planMd}</Markdown>
            </div>
          </details>
        ) : (
          <p className="text-sm italic text-ink-faint">No plan authored yet.</p>
        )}
      </section>

      {/* Execute card */}
      <section className="rounded-[var(--r-lg)] border border-line bg-surface-1 p-4">
        <h3 className="mb-3 font-serif text-base">Execute</h3>
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {tasks.length === 0 && <p className="text-sm italic text-ink-faint">No tasks yet.</p>}
          {tasks.map((t) => {
            const meta = STATUS_META[t.status] ?? STATUS_META.queued;
            const isCurrent = t.id === currentTaskId;
            return (
              <div
                key={t.id}
                aria-current={isCurrent ? 'step' : undefined}
                className={`rounded-[var(--r-md)] border p-2 ${isCurrent ? 'border-amber-400 bg-amber-50/40' : 'border-line bg-surface-2'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">{t.title}</span>
                  <span className={`text-xs ${meta.tint}`}>
                    {meta.icon} {meta.label}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <span>{t.repoName}</span>
                  {t.branch && <span className="rounded border border-line px-1">{t.branch}</span>}
                  {t.commitSha && <span className="font-mono">{t.commitSha.slice(0, 8)}</span>}
                  {t.reviewPolicy !== 'full' && <span className="italic">policy: {t.reviewPolicy}</span>}
                </div>
                {t.fixNote && (
                  <p className="mt-1 text-xs text-rose-600">inline fix: {t.fixNote}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Review card */}
      <section className="rounded-[var(--r-lg)] border border-line bg-surface-1 p-4">
        <h3 className="mb-3 font-serif text-base">Review</h3>
        {reviews.length === 0 && <p className="text-sm italic text-ink-faint">No reviews yet.</p>}
        <div className="flex flex-col gap-2">
          {reviews.map((r) => (
            <div key={r.repo} className="flex items-center justify-between rounded-[var(--r-md)] border border-line bg-surface-2 p-2 text-sm">
              <span>{r.repo}</span>
              <span
                className={`text-xs ${r.verdict === 'approved' ? 'text-emerald-700' : r.verdict === 'error' ? 'text-ink-faint' : 'text-rose-600'}`}
              >
                {r.verdict === 'approved' ? '✓ approved' : r.verdict === 'error' ? '— review unavailable' : '✕ changes required'} · {r.findingsCount} finding{r.findingsCount === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
