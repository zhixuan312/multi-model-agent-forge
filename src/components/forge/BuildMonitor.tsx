'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Circle,
  RefreshCw,
  ScanEye,
  Wrench,
  Check,
  Minus,
  X,
  CheckCircle2,
} from 'lucide-react';
import type { ProjectEvent } from '@/sse/event-bus';
import type { BuildView, BuildPlanTaskView } from '@/build/plan-types';
import { ProseBlock } from '@/components/patterns/prose-block';
import { Card, CardContent, Badge, Banner, Heading, Text, TextSm, Mono } from '@/components/ui';
import { cn } from '@/lib/cn';

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

const STATUS_META: Record<string, { label: string; icon: ReactNode; tint: string }> = {
  queued: { label: 'queued', icon: <Circle aria-hidden="true" className="size-3.5" />, tint: 'text-ink-faint' },
  executing: { label: 'executing', icon: <RefreshCw aria-hidden="true" className="size-3.5" />, tint: 'text-[var(--amber)]' },
  verifying: { label: 'verifying', icon: <ScanEye aria-hidden="true" className="size-3.5" />, tint: 'text-[var(--amber)]' },
  fixing: { label: 'fixing', icon: <Wrench aria-hidden="true" className="size-3.5" />, tint: 'text-[var(--rose)]' },
  committed: { label: 'committed', icon: <Check aria-hidden="true" className="size-3.5" />, tint: 'text-[var(--sage-deep)]' },
  skipped: { label: 'skipped', icon: <Minus aria-hidden="true" className="size-3.5" />, tint: 'text-ink-faint' },
  failed: { label: 'failed', icon: <X aria-hidden="true" className="size-3.5" />, tint: 'text-[var(--rose)]' },
};

export function BuildMonitor({ projectId, initial }: { projectId: string; initial: BuildView }) {
  const [tasks, setTasks] = useState<BuildPlanTaskView[]>(initial.tasks);
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
    function patch(id: string, fn: (t: BuildPlanTaskView) => BuildPlanTaskView): void {
      setTasks((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
    }
  }, [projectId]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      {/* Header — running spend chip (observability only). */}
      <header className="flex items-center justify-between gap-3">
        <Heading>Build pipeline</Heading>
        <Badge
          variant="neutral"
          title="Running spend — observability only, no cost cap"
          className="font-mono"
        >
          ${cost.total.toFixed(4)} · audit ${cost.byRoute.audit.toFixed(3)} · exec ${cost.byRoute.executePlan.toFixed(3)} · review ${cost.byRoute.review.toFixed(3)}
        </Badge>
      </header>

      {notice && (
        <Banner variant="warning" title={notice} />
      )}

      {/* Plan card */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Heading className="!text-base">Plan</Heading>
          <TextSm className="!text-ink-soft">
            Write targets: <span className="text-ink">{initial.writeTargets.join(', ') || '—'}</span>
            {initial.readOnly.length > 0 && (
              <>
                {' · '}Read-only: <span className="text-ink">{initial.readOnly.join(', ')}</span>
              </>
            )}
          </TextSm>
          <div className="flex flex-wrap gap-2">
            {auditPasses.map((p) => (
              <Badge key={p.passNo} variant={p.verdict === 'clean' ? 'sage' : 'amber'}>
                pass {p.passNo}: {p.findingsCount} finding{p.findingsCount === 1 ? '' : 's'}{' '}
                {p.verdict === 'clean' ? '✓ clean' : '⟳ revised'}
              </Badge>
            ))}
          </div>
          {initial.planMd ? (
            <details>
              <summary className="cursor-pointer text-xs text-ink-faint">
                Plan v{initial.planVersion} (markdown)
              </summary>
              <div className="mt-2 max-h-80 overflow-auto rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
                <ProseBlock>{initial.planMd}</ProseBlock>
              </div>
            </details>
          ) : (
            <Text className="!text-sm italic !text-ink-faint">No plan authored yet.</Text>
          )}
        </CardContent>
      </Card>

      {/* Execute card */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Heading className="!text-base">Execute</Heading>
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            {tasks.length === 0 && <Text className="!text-sm italic !text-ink-faint">No tasks yet.</Text>}
            {tasks.map((t) => {
              const meta = STATUS_META[t.status] ?? STATUS_META.queued;
              const isCurrent = t.id === currentTaskId;
              return (
                <div
                  key={t.id}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'rounded-[var(--r-md)] border p-2',
                    isCurrent ? 'border-[var(--amber)] bg-amber-tint/40' : 'border-line bg-surface-2',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink">{t.title}</span>
                    <span className={cn('inline-flex items-center gap-1.5 text-xs', meta.tint)}>
                      {meta.icon} {meta.label}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                    <span>{t.repoName}</span>
                    {t.branch && <span className="rounded border border-line px-1">{t.branch}</span>}
                    {t.commitSha && <Mono className="!text-xs">{t.commitSha.slice(0, 8)}</Mono>}
                    {t.reviewPolicy !== 'full' && (
                      <Mono className="!text-xs italic">policy: {t.reviewPolicy}</Mono>
                    )}
                  </div>
                  {t.fixNote && (
                    <TextSm className="mt-1 !text-xs !text-rose">inline fix: {t.fixNote}</TextSm>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Review card */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Heading className="!text-base">Review</Heading>
          {reviews.length === 0 && <Text className="!text-sm italic !text-ink-faint">No reviews yet.</Text>}
          <div className="flex flex-col gap-2">
            {reviews.map((r) => (
              <div
                key={r.repo}
                className="flex items-center justify-between gap-2 rounded-[var(--r-md)] border border-line bg-surface-2 p-2 text-sm"
              >
                <span className="text-ink">{r.repo}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-xs',
                    r.verdict === 'approved'
                      ? 'text-[var(--sage-deep)]'
                      : r.verdict === 'error'
                        ? 'text-ink-faint'
                        : 'text-[var(--rose)]',
                  )}
                >
                  {r.verdict === 'approved' ? (
                    <>
                      <CheckCircle2 aria-hidden="true" className="size-3.5" /> approved
                    </>
                  ) : r.verdict === 'error' ? (
                    '— review unavailable'
                  ) : (
                    <>
                      <X aria-hidden="true" className="size-3.5" /> changes required
                    </>
                  )}{' '}
                  · {r.findingsCount} finding{r.findingsCount === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
