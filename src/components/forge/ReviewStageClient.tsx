'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  ScanSearch,
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
import { StageAdvance } from '@/components/forge/StageAdvance';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { RailNote } from '@/components/patterns/feature-rail';
import type { ProjectPhase } from '@/db/enums';

const REVIEW_NOTE = `### How code review works

- **10 categories** — correctness, security, performance, maintainability, testing, error handling, naming, documentation, complexity, style
- **Findings** — each has a severity, file location, and fix suggestion
- **Apply** — selected findings are delegated to a worker for automatic fixes

### When to move on

- **Clean pass** — no merge-blocking issues remain
- **Re-review** — run again after applying fixes to verify`;

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

export interface ReviewStageClientProps {
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
  passes: ReviewPassView[];
  reviewRunning: boolean;
  applyRunning: boolean;
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
  const readOnly = false;

  useEffect(() => { stagePhaseStore.set('review'); }, []);

  const [activePassNo, setActivePassNo] = useState(props.passes.length || 1);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const refresh = useCallback(() => { router.refresh(); }, [router]);
  const mma = useMmaDispatch(props.projectId, {
    onDone: {
      'code-review': refresh,
      'review-apply': refresh,
    },
  });

  const reviewing = props.reviewRunning || mma.busyHandlers.has('code-review');
  const applying = props.applyRunning || mma.busyHandlers.has('review-apply');

  const activePass = props.passes.find((p) => p.passNo === activePassNo);
  const lastPass = props.passes[props.passes.length - 1];
  const lastPassClean = !!(lastPass && lastPass.findings.length === 0);
  const isViewingPast = activePass && activePass.passNo < props.passes.length;
  const isApplied = (idx: number) => activePass?.appliedIndices.includes(idx) ?? false;
  const allApplied = activePass ? activePass.appliedIndices.length > 0 : false;

  async function runReview() {
    await mma.dispatch(`/api/projects/${props.projectId}/review/run`, 'code-review', {});
  }

  async function applySelected() {
    if (!activePass || selected.size === 0) return;
    await mma.dispatch(
      `/api/projects/${props.projectId}/review/apply`,
      'review-apply',
      { passNo: activePass.passNo, findingIndices: [...selected] },
    );
  }

  function toggleSelect(idx: number) {
    setSelected((s) => { const n = new Set(s); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
  }

  function toggleSelectAll() {
    if (!activePass) return;
    const selectable = activePass.findings.map((_, i) => i).filter((i) => !isApplied(i));
    const allSelected = selectable.every((i) => selected.has(i));
    setSelected(allSelected ? new Set() : new Set(selectable));
  }
  const allSelectable = activePass ? activePass.findings.map((_, i) => i).filter((i) => !isApplied(i)) : [];
  const allSelected = allSelectable.length > 0 && allSelectable.every((i) => selected.has(i));

  return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        {/* LEFT — data-driven content */}
        <Card className="flex min-h-0 flex-col lg:col-span-2">
          {!activePass ? (
            <>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  {reviewing ? <Loader2 className="size-4 shrink-0 animate-spin text-accent" /> : <ScanSearch className="size-4 shrink-0 text-accent" />}
                  <CardTitle>Code review</CardTitle>
                  <Badge variant={reviewing ? 'accent' : 'neutral'} size="sm">{reviewing ? 'reviewing' : 'no review yet'}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-16">
                {reviewing ? (
                  <>
                    <Loader2 className="size-8 animate-spin text-accent" />
                    <p className="text-sm font-medium text-ink">Reviewing changes…</p>
                    <p className="text-center text-xs text-ink-faint" style={{ maxWidth: 300 }}>
                      MMA is checking all 10 categories: test gaps, security regression, cross-file ripple, missing edge cases, performance, and more.
                    </p>
                  </>
                ) : (
                  <>
                    <ScanSearch className="size-8 text-ink-faint/30" />
                    <p className="text-sm font-medium text-ink-soft">No review findings yet</p>
                    <p className="text-center text-xs text-ink-faint" style={{ maxWidth: 280 }}>
                      Run a code review to check the changes for correctness, security, performance, and style issues.
                    </p>
                  </>
                )}
              </CardContent>
            </>
          ) : activePass && activePass.findings.length === 0 ? (
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
                <div className="flex min-w-0 items-center gap-2">
                  <ScanSearch className="size-4 shrink-0 text-accent" />
                  <CardTitle>Pass {activePassNo}</CardTitle>
                  <Badge variant={activePass.findings.length > 0 ? 'amber' : 'sage'} size="sm">
                    {activePass.findings.length > 0 ? `${activePass.findings.length} findings` : 'clean'}
                  </Badge>
                  {allApplied && <Badge variant="sage" size="sm">applied</Badge>}
                </div>
                {!isViewingPast && !allApplied && activePass.findings.length > 0 && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={toggleSelectAll}>{allSelected ? 'Unselect all' : 'Select all'}</Button>
                    <Button size="sm" onClick={applySelected} disabled={selected.size === 0 || applying}>
                      Apply {selected.size} selected
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto !p-0">
                <div className="grid grid-cols-1 gap-px bg-line/50">
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
                            'flex gap-3 rounded-[var(--r-md)] border p-4 text-left transition-colors',
                            applied ? 'border-[var(--sage-tint)] bg-sage-tint/20' : on ? 'border-accent bg-accent-tint/30' : 'border-line bg-surface hover:bg-surface-2/50',
                            disabled && !applied && 'opacity-50',
                          )}
                        >
                          {/* Checkbox */}
                          <span className={cn(
                            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border text-[10px] font-semibold transition-colors',
                            applied ? 'border-[var(--sage-deep)] bg-[var(--sage-deep)] text-white'
                              : on ? 'border-accent bg-accent text-white'
                              : 'border-line-strong text-ink-faint',
                          )}>
                            {applied ? <Check className="size-3" /> : on ? <Check className="size-3" /> : origIdx + 1}
                          </span>

                          {/* Content */}
                          <div className="min-w-0 flex-1 space-y-2">
                            {/* Top row: severity + category */}
                            <div className="flex items-center gap-2">
                              <span className={cn('inline-flex shrink-0 items-center justify-center rounded-[5px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEV_STYLE[f.weight] ?? SEV_STYLE.medium)}>
                                {f.weight}
                              </span>
                              <span className="text-xs font-medium text-ink-faint">{f.category.replace(/-/g, ' ')}</span>
                              {f.file && (
                                <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-faint">{f.file}{f.line > 0 ? `:${f.line}` : ''}</span>
                              )}
                            </div>

                            {/* Claim */}
                            <p className="text-sm leading-relaxed text-ink">{f.claim}</p>

                            {/* Evidence */}
                            {f.evidence && (
                              <div className="rounded-[var(--r-sm)] bg-surface-2 px-3 py-2">
                                <code className="whitespace-pre-wrap text-xs leading-relaxed text-ink-soft">{f.evidence}</code>
                              </div>
                            )}

                            {/* Suggestion */}
                            {f.suggestion && (
                              <p className="text-xs leading-relaxed text-accent-deep">
                                <span className="font-semibold">Fix:</span> {f.suggestion}
                              </p>
                            )}
                          </div>
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

        {/* RIGHT — guidance + rounds rail */}
        <aside className="flex min-h-0 flex-col gap-4">
          <RailNote icon={<ScanSearch />}>{REVIEW_NOTE}</RailNote>

          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader>
              <CardTitle>Review rounds</CardTitle>
              {!reviewing && !applying && (
                <Button size="sm" variant="primary" onClick={runReview} disabled={readOnly || reviewing || applying}>
                  <ScanSearch className="size-3" />
                  {props.passes.length === 0 ? 'Run review' : 'Re-run'}
                </Button>
              )}
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
              {(reviewing || applying) && (
                <div className="w-full rounded-[var(--r-md)] border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {applying ? 'Applying fixes' : `Pass ${props.passes.length + 1}`}
                    </span>
                    <Badge variant="neutral" size="sm">running</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin text-accent" />
                    <span className="text-xs text-ink-soft">
                      {applying ? 'Delegate worker applying fixes…' : 'Reviewing changes…'}
                    </span>
                  </div>
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
                    onClick={() => setActivePassNo(p.passNo)}
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
                disabled={readOnly}
                projectId={props.projectId}
                from="review"
                testId="review-continue-link"
              />
            </CardFooter>
          </Card>
        </aside>
      </div>
  );
}
