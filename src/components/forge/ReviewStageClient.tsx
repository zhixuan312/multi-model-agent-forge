'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';
import {
  ArrowRight,
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
import { FindingsGrid, AuditRoundCard, type Finding } from '@/components/patterns/findings';
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
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto !p-0">
                <FindingsGrid
                  findings={activePass.findings.map((f) => ({
                    severity: f.weight as Finding['severity'],
                    category: f.category,
                    claim: f.claim,
                    evidence: f.evidence,
                    suggestion: f.suggestion,
                  }))}
                  selectable={!isViewingPast && !allApplied}
                  applying={applying}
                  applied={allApplied}
                  readOnly={readOnly}
                  selectedIndices={[...selected]}
                  onSelectionChange={(indices) => setSelected(new Set(indices))}
                  onApply={(indices) => {
                    setSelected(new Set(indices));
                    void mma.dispatch(
                      `/api/projects/${props.projectId}/review/apply`,
                      'review-apply',
                      { passNo: activePass.passNo, findingIndices: indices },
                    );
                  }}
                  appliedLabel={`${activePass.appliedIndices.length} finding${activePass.appliedIndices.length !== 1 ? 's' : ''} applied — re-run review to verify.`}
                  hideApplyBar
                />
              </CardContent>
              {!isViewingPast && !allApplied && activePass.findings.length > 0 && (
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
                  <Button size="sm" variant="ghost" onClick={() => {
                    const all = activePass.findings.map((_, i) => i);
                    setSelected((s) => s.size === activePass.findings.length ? new Set() : new Set(all));
                  }}>
                    {selected.size === activePass.findings.length ? 'Unselect all' : 'Select all'}
                  </Button>
                  <Button size="sm" onClick={() => {
                    const indices = [...selected];
                    void mma.dispatch(`/api/projects/${props.projectId}/review/apply`, 'review-apply', { passNo: activePass.passNo, findingIndices: indices });
                  }} disabled={selected.size === 0 || applying} loading={applying}>
                    Apply ({selected.size || 'all'})
                  </Button>
                </div>
              )}
              {applying && (
                <div className="flex items-center gap-2 border-t border-line px-5 py-3">
                  <Loader2 className="size-3.5 animate-spin text-accent" />
                  <span className="text-xs font-medium text-accent-deep">Applying {selected.size} finding{selected.size !== 1 ? 's' : ''}...</span>
                </div>
              )}
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
              {reviewing && (
                <div className="flex items-center gap-2 rounded-[var(--r-md)] border border-accent/30 bg-accent-tint/30 px-3 py-2">
                  <Loader2 className="size-3.5 animate-spin text-accent" />
                  <span className="text-xs font-medium text-accent-deep">
                    Running pass {props.passes.length + 1}...
                  </span>
                </div>
              )}
              {[...props.passes].reverse().map((p) => {
                const isActive = p.passNo === activePassNo && !reviewing;
                const hasApplied = p.appliedIndices.length > 0;
                const hasCritHigh = p.findings.some((f) => f.weight === 'critical' || f.weight === 'high');
                return (
                  <div key={p.passNo}>
                    <AuditRoundCard
                      passNo={p.passNo}
                      verdict={p.findings.length === 0 ? 'clean' : hasCritHigh ? 'revised' : 'clean'}
                      findings={p.findings.map((f) => ({
                        severity: f.weight as Finding['severity'],
                        category: f.category,
                        claim: f.claim,
                        evidence: f.evidence,
                        suggestion: f.suggestion,
                      }))}
                      applied={hasApplied}
                      active={isActive}
                      onClick={() => setActivePassNo(p.passNo)}
                    />
                    {applying && isActive ? (
                      <div className="mt-1.5 flex items-center gap-2 rounded-[var(--r-md)] border border-accent/30 bg-accent-tint/30 px-3 py-1.5">
                        <Loader2 className="size-3.5 animate-spin text-accent" />
                        <span className="text-xs font-medium text-accent-deep">
                          Applying {selected.size} finding{selected.size !== 1 ? 's' : ''}...
                        </span>
                      </div>
                    ) : null}
                  </div>
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
