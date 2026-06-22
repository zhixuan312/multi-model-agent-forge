'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Shield,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Banner,
  TextSm,
  Eyebrow,
} from '@/components/ui';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { AutomationBar, type AutoMode } from '@/components/forge/AutomationBar';
import { StageAdvance } from '@/components/forge/StageAdvance';
import type { ProjectPhase } from '@/db/enums';

/* ── Types ───────────────────────────────────────────────────────── */

export interface ReviewFindingView {
  weight: string;
  category: string;
  claim: string;
  evidence: string;
  file: string;
  line: number;
  suggestion: string;
}

export interface ReviewPassView {
  passNo: number;
  status: 'done' | 'failed';
  findings: ReviewFindingView[];
  appliedIndices: number[];
}

type ReviewPhase = 'inspect' | 'judge' | 'resolve';

export interface ReviewStageClientProps {
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
  passes: ReviewPassView[];
  reviewRunning: boolean;
  applyRunning: boolean;
  initialPhase?: ReviewPhase;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const SEV_STYLE: Record<string, string> = {
  critical: 'bg-rose-tint text-[var(--rose)]',
  high: 'bg-amber-tint text-[var(--amber)]',
  medium: 'bg-[var(--frost)] text-[var(--steel)]',
  low: 'bg-surface-2 text-ink-soft',
};

function sevCounts(findings: ReviewFindingView[]): Record<string, number> {
  const c: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) if (f.weight in c) c[f.weight]++;
  return c;
}

/* ── Main Component ──────────────────────────────────────────────── */

export function ReviewStageClient(props: ReviewStageClientProps) {
  const router = useRouter();
  const readOnly = props.phase !== 'build';

  const derivePhase = (): ReviewPhase => {
    if (props.passes.length === 0) return 'inspect';
    const lastPass = props.passes[props.passes.length - 1];
    if (lastPass.findings.length === 0) return 'resolve';
    return 'judge';
  };

  const [phase, setPhaseRaw] = useState<ReviewPhase>(props.initialPhase ?? derivePhase());
  const [reviewing, setReviewing] = useState(props.reviewRunning);
  const [applying, setApplying] = useState(props.applyRunning);
  const [activePassNo, setActivePassNo] = useState(props.passes.length || 1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');

  const setPhase = (p: ReviewPhase) => {
    setPhaseRaw(p);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('phase', p);
      router.push(url.pathname + url.search, { scroll: false });
    }
  };

  useEffect(() => stagePhaseStore.set(phase), [phase]);
  useEffect(
    () => stagePhaseStore.onNavigate((key) => {
      if (key === 'inspect' || key === 'judge' || key === 'resolve') setPhase(key as ReviewPhase);
    }),
    [],
  );

  // SSE listener
  useEffect(() => {
    if (!reviewing && !applying) return;
    const es = new EventSource(`/api/projects/${props.projectId}/events`);
    es.onmessage = (msg) => {
      try {
        const e = JSON.parse(msg.data) as Record<string, unknown>;
        if ((e.type === 'dispatch.done' || e.type === 'dispatch.failed') &&
            (e.handler === 'code-review' || e.handler === 'review-apply')) {
          window.location.reload();
        }
      } catch {}
    };
    return () => es.close();
  }, [reviewing, applying, props.projectId]);

  const activePass = props.passes.find((p) => p.passNo === activePassNo);
  const isViewingPast = activePass && activePass.passNo < props.passes.length;
  const isApplied = (idx: number) => activePass?.appliedIndices.includes(idx) ?? false;
  const allApplied = activePass ? activePass.appliedIndices.length > 0 : false;

  async function runReview() {
    setReviewing(true);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/review/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!res.ok) setReviewing(false);
    } catch { setReviewing(false); }
  }

  async function applySelected() {
    if (!activePass || selected.size === 0) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/review/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passNo: activePass.passNo, findingIndices: [...selected] }),
      });
      if (!res.ok) setApplying(false);
    } catch { setApplying(false); }
  }

  function toggleSelect(idx: number) {
    setSelected((s) => { const n = new Set(s); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
  }

  function selectAll() {
    if (!activePass) return;
    const all = new Set(activePass.findings.map((_, i) => i).filter((i) => !isApplied(i)));
    setSelected(all);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="review-stage">
      <AutomationBar
        mode={auto} note={autoNote} disabled={readOnly}
        idleHint="Run code review, fix findings, re-run until clean."
        runningHint="Forge reviews, applies critical/high fixes, and re-runs. Stop anytime."
        onRun={() => { setAuto('running'); setAutoNote('Running review…'); runReview(); }}
        onStop={() => { setAuto('off'); setAutoNote('Stopped.'); }}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        {/* LEFT — findings card */}
        <Card className="flex min-h-0 flex-col lg:col-span-2">
          {phase === 'inspect' && !reviewing && props.passes.length === 0 ? (
            <>
              <CardHeader><CardTitle><Shield className="size-4 text-accent" /> Code review</CardTitle><Badge variant="neutral" size="sm">no review yet</Badge></CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-16">
                <span className="text-3xl opacity-25">🔍</span>
                <p className="text-sm font-medium text-ink-soft">No review findings yet</p>
                <p className="text-center text-xs text-ink-faint" style={{ maxWidth: 280 }}>Run a code review to check the changes for correctness, security, performance, and style issues.</p>
              </CardContent>
            </>
          ) : reviewing ? (
            <>
              <CardHeader style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <CardTitle><Loader2 className="size-4 animate-spin text-accent" /> Code review</CardTitle>
                <Badge variant="accent" size="sm">reviewing</Badge>
              </CardHeader>
              <div className="flex items-center gap-2 border-b border-accent-tint bg-accent-tint px-4 py-2">
                <Loader2 className="size-3 animate-spin text-accent" />
                <span className="text-xs font-medium">Pass {props.passes.length + 1} — reviewing…</span>
              </div>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-16">
                <Loader2 className="size-7 animate-spin text-accent" />
                <p className="text-sm font-medium">Checking correctness, security, performance…</p>
                <p className="text-xs text-ink-faint">10 categories</p>
              </CardContent>
            </>
          ) : applying ? (
            <>
              <CardHeader><CardTitle><Loader2 className="size-4 animate-spin text-accent" /> Applying fixes</CardTitle><Badge variant="accent" size="sm">applying</Badge></CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-16">
                <Loader2 className="size-7 animate-spin text-accent" />
                <p className="text-sm font-medium">Applying {selected.size} fix{selected.size !== 1 ? 'es' : ''}…</p>
                <p className="text-xs text-ink-faint">MMA delegate (complex tier) working in worktree</p>
              </CardContent>
            </>
          ) : phase === 'resolve' && activePass?.findings.length === 0 ? (
            <>
              <CardHeader style={{ borderBottomColor: 'var(--sage-tint)' }}>
                <CardTitle><span className="text-[var(--sage)]">✓</span> Pass {activePassNo} — clean</CardTitle>
                <Badge variant="sage" size="sm">no merge-blocking issues</Badge>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-16">
                <span className="text-3xl">✅</span>
                <p className="text-sm font-semibold text-[var(--sage-deep)]">All clear</p>
                <p className="text-center text-xs text-ink-faint">10 categories checked — no merge-blocking issues.</p>
              </CardContent>
            </>
          ) : activePass ? (
            <>
              <CardHeader>
                <CardTitle>
                  <Shield className="size-4 text-accent" />
                  Pass {activePassNo}
                  <Badge variant={activePass.findings.length > 0 ? 'amber' : 'sage'} size="sm">
                    {activePass.findings.length > 0 ? `${activePass.findings.length} findings` : 'clean'}
                  </Badge>
                  {allApplied && <Badge variant="sage" size="sm">applied</Badge>}
                </CardTitle>
                {!isViewingPast && !allApplied && activePass.findings.length > 0 && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={selectAll}>Select all</Button>
                    <Button size="sm" onClick={applySelected} disabled={selected.size === 0 || applying}>
                      Apply {selected.size} selected
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto !p-0">
                <div className="grid grid-cols-1 gap-px bg-line/50 sm:grid-cols-2">
                  {[...activePass.findings]
                    .map((f, origIdx) => ({ f, origIdx }))
                    .sort((a, b) => SEVERITY_ORDER.indexOf(a.f.weight) - SEVERITY_ORDER.indexOf(b.f.weight))
                    .map(({ f, origIdx }) => {
                      const applied = isApplied(origIdx);
                      const on = selected.has(origIdx);
                      const disabled = readOnly || isViewingPast || allApplied || applied || applying;
                      return (
                        <button
                          key={origIdx}
                          type="button"
                          disabled={disabled}
                          onClick={() => !disabled && toggleSelect(origIdx)}
                          className={cn(
                            'flex flex-col gap-1.5 p-3 text-left transition-colors',
                            applied ? 'bg-sage-tint/30' : on ? 'bg-accent-tint/40' : 'bg-surface hover:bg-surface-2/50',
                            disabled && !applied && 'opacity-50',
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              'grid size-5 shrink-0 place-items-center rounded-[6px] border text-[10px] font-semibold transition-colors',
                              applied ? 'border-[var(--sage-deep)] bg-[var(--sage-deep)] text-white'
                                : on ? 'border-accent bg-accent text-white'
                                : 'border-line-strong text-ink-faint',
                            )}>
                              {applied ? <Check className="size-3" /> : on ? <Check className="size-3" /> : origIdx + 1}
                            </span>
                            <span className={cn('inline-flex w-[54px] shrink-0 items-center justify-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEV_STYLE[f.weight] ?? SEV_STYLE.medium)}>
                              {f.weight}
                            </span>
                          </div>
                          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">{f.category.replace(/-/g, ' ')}</span>
                          <p className="text-xs leading-relaxed text-ink">{f.claim}</p>
                          {f.evidence && <p className="text-[10px] leading-relaxed text-ink-soft"><span className="font-semibold">Evidence:</span> {f.evidence}</p>}
                          {f.file && <p className="font-mono text-[10px] text-ink-faint">{f.file}{f.line > 0 ? `:${f.line}` : ''}</p>}
                          {f.suggestion && <p className="text-[10px] leading-relaxed text-accent-deep"><span className="font-semibold">Fix:</span> {f.suggestion}</p>}
                        </button>
                      );
                    })}
                </div>
                {!isViewingPast && !allApplied && activePass.findings.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/40 px-3.5 py-2.5">
                    <span className="text-xs text-ink-faint">{selected.size} of {activePass.findings.length} selected</span>
                    <span className="flex-1" />
                    <Button size="sm" variant="secondary" onClick={() => {
                      setSelected(new Set(activePass.findings.map((_, i) => i)));
                      void applySelected();
                    }}>Apply all {activePass.findings.length}</Button>
                    <Button size="sm" onClick={applySelected} disabled={selected.size === 0 || applying}>
                      Apply {selected.size} selected
                    </Button>
                  </div>
                )}
                {allApplied && (
                  <div className="flex items-center gap-2 border-t border-line bg-sage-tint/20 px-3.5 py-2.5">
                    <Check className="size-3.5 text-[var(--sage-deep)]" />
                    <span className="text-xs font-medium text-[var(--sage-deep)]">
                      {activePass.appliedIndices.length} finding{activePass.appliedIndices.length !== 1 ? 's' : ''} applied — re-run review to verify.
                    </span>
                  </div>
                )}
              </CardContent>
            </>
          ) : null}
        </Card>

        {/* RIGHT — rounds rail */}
        <aside className="flex min-h-0 flex-col gap-4">
          <div className={cn('flex items-start gap-3 rounded-[var(--r-lg)] border px-4 py-4',
            phase === 'resolve' ? 'border-[var(--sage-tint)] bg-[var(--sage-tint)]/40' : 'border-accent-tint bg-accent-tint/40',
          )}>
            <span className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-full',
              phase === 'resolve' ? 'bg-[var(--sage-tint)] text-[var(--sage)]' : 'bg-accent-tint text-accent',
            )}>
              {reviewing ? <Loader2 className="size-5 animate-spin" /> : phase === 'resolve' ? <CheckCircle2 className="size-5" /> : <Shield className="size-5" />}
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">
                {reviewing ? 'Reviewing…' : applying ? 'Applying fixes…' : phase === 'resolve' ? 'Review clean' : props.passes.length === 0 ? 'Code review' : `${activePass?.findings.length ?? 0} findings`}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                {reviewing ? 'MMA sweeps all 10 categories. Findings appear when complete.'
                  : applying ? 'Delegate worker applying fixes in worktree.'
                  : phase === 'resolve' ? 'All merge-blocking issues resolved. Ready to close the loop.'
                  : props.passes.length === 0 ? '10 review categories: security, test gaps, cross-file ripple…'
                  : 'Select findings to fix. Each dispatches a delegate worker.'}
              </p>
            </div>
          </div>

          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader>
              <CardTitle>Review rounds</CardTitle>
              {!reviewing && !applying && (
                <Button size="sm" variant={props.passes.length === 0 ? 'primary' : 'secondary'} onClick={runReview} disabled={readOnly || reviewing || applying}>
                  <Shield className="size-3" />
                  {props.passes.length === 0 ? 'Run review' : 'Re-run'}
                </Button>
              )}
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
              {reviewing && (
                <div className="flex items-center gap-2 rounded-[var(--r-md)] border border-accent bg-accent-tint p-2.5">
                  <Loader2 className="size-3 animate-spin text-accent" />
                  <span className="text-xs font-semibold">Pass {props.passes.length + 1}</span>
                  <Badge variant="accent" size="sm">running</Badge>
                </div>
              )}
              {[...props.passes].reverse().map((p) => {
                const isActive = p.passNo === activePassNo && !reviewing;
                const counts = sevCounts(p.findings);
                const hasApplied = p.appliedIndices.length > 0;
                return (
                  <button
                    key={p.passNo}
                    type="button"
                    onClick={() => { setActivePassNo(p.passNo); if (props.passes.length > 0) setPhase('judge'); }}
                    className={cn(
                      'w-full rounded-[var(--r-md)] border p-2.5 text-left transition-colors',
                      isActive ? 'border-accent bg-accent-tint' : hasApplied ? 'border-[var(--sage-tint)] hover:bg-sage-tint/10' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {hasApplied && <span className="text-[var(--sage)]">✓</span>}
                        <span className="text-xs font-semibold">Pass {p.passNo}</span>
                      </div>
                      <Badge variant={p.findings.length === 0 ? 'sage' : hasApplied ? 'sage' : 'neutral'} size="sm">
                        {p.findings.length === 0 ? 'clean' : hasApplied ? `${p.appliedIndices.length} fixed` : `${p.findings.length} findings`}
                      </Badge>
                    </div>
                    {p.findings.length > 0 && !hasApplied && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => (
                          <span key={s} className={cn('rounded-[4px] px-1.5 py-0.5 text-[9px] font-semibold uppercase', SEV_STYLE[s])}>
                            {counts[s]} {s}
                          </span>
                        ))}
                      </div>
                    )}
                    {hasApplied && p.findings.length - p.appliedIndices.length > 0 && (
                      <p className="mt-1 text-[10px] text-ink-faint">{p.findings.length - p.appliedIndices.length} accepted</p>
                    )}
                  </button>
                );
              })}
              {props.passes.length === 0 && !reviewing && (
                <p className="py-4 text-center text-xs text-ink-faint">Each round appears here with its findings.</p>
              )}
            </CardContent>
            <CardFooter className="flex-col !items-stretch gap-2">
              <StageAdvance
                href={`/projects/${props.projectId}/journal`}
                label="Continue to Journal"
                disabled={props.passes.length === 0 || readOnly}
                testId="review-continue-link"
              />
              {props.passes.length === 0 && <TextSm className="text-center !text-ink-faint">Run at least one review first</TextSm>}
            </CardFooter>
          </Card>
        </aside>
      </div>
    </div>
  );
}
