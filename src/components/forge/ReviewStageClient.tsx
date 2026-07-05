'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';
import { Loader2, ScanSearch } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
} from '@/components/ui';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { AutomationBar } from '@/components/forge/AutomationBar';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { RailNote } from '@/components/patterns/feature-rail';
import { FindingsGrid, AuditRoundCard, type Finding } from '@/components/patterns/findings';

const REVIEW_NOTE = `### Review — check the code changes

- **Run review** — MMA checks 10 categories: correctness, security, performance, testing, and more
- **Findings** — each has a severity, file location, and fix suggestion
- **Apply** — selected findings are fixed by an agent and committed to the PR branch

### When to advance

- **Clean pass** — no merge-blocking issues remain
- **Re-run** — run again after applying fixes to verify
- The PR is automatically updated when fixes are pushed`;

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
  passes: ReviewPassView[];
  reviewRunning: boolean;
  applyRunning: boolean;
  buildPrs?: Record<string, { url: string; branch: string; targetBranch: string }>;
  autoMode?: boolean;
  autoNote?: string;
  readOnly?: boolean;
}

function toFinding(f: ReviewFindingView): Finding {
  return { severity: f.weight as Finding['severity'], category: f.category, claim: f.claim, evidence: f.evidence, suggestion: f.suggestion };
}

/* ── Main Component ──────────────────────────────────────────────── */

export function ReviewStageClient(props: ReviewStageClientProps) {
  const router = useRouter();
  const readOnly = props.readOnly ?? false;

  useEffect(() => { stagePhaseStore.set('review'); }, []);

  const [activePassNo, setActivePassNo] = useState(props.passes.length || 1);

  const refresh = useCallback(() => { router.refresh(); }, [router]);
  // dispatch_review / apply_review_findings are synchronous effects (await:true) —
  // the no-handler transition resolves the POST when their terminal handler has
  // recorded the pass, so local flags drive button state (no SSE busy-handler).
  const mma = useMmaDispatch(props.projectId);
  const [reviewingLocal, setReviewingLocal] = useState(false);
  const [applyingLocal, setApplyingLocal] = useState(false);

  const reviewing = props.reviewRunning || reviewingLocal;
  const applying = props.applyRunning || applyingLocal;

  function runReview() {
    if (reviewingLocal) return;
    setReviewingLocal(true);
    void mma.transition('dispatch_review')
      .then(() => refresh())
      .catch(() => {})
      .finally(() => setReviewingLocal(false));
  }

  const auto: 'off' | 'running' = props.autoMode ? 'running' : 'off';
  const autoNote = props.autoNote ?? '';

  const activePass = props.passes.find((p) => p.passNo === activePassNo);
  const isViewingPast = activePass && activePass.passNo < props.passes.length;
  const allApplied = activePass ? activePass.appliedIndices.length > 0 : false;

  // Sync to latest pass when new passes arrive
  useEffect(() => {
    if (props.passes.length > 0) setActivePassNo(props.passes[props.passes.length - 1].passNo);
  }, [props.passes.length]);


  function apply(passNo: number) {
    if (readOnly || applying) return;
    const pass = props.passes.find((p) => p.passNo === passNo);
    if (!pass || pass.findings.length === 0) return;
    // apply_review_findings re-fixes ALL of the latest pass's findings for the repo
    // (the single shared implementation — auto and manual apply the same way, so the
    // UI applies the whole pass rather than a subset the effect would ignore).
    setApplyingLocal(true);
    void mma.transition('apply_review_findings')
      .then(() => refresh())
      .catch(() => {})
      .finally(() => setApplyingLocal(false));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <AutomationBar
        projectId={props.projectId}
        mode={auto}
        note={autoNote}
        disabled={readOnly}
        idleHint="Review the code changes, or let Forge run the review automatically."
        runningHint="Forge reviews the code, applies fixes, then advances to Reflect."
      />
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* LEFT — findings content */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        {!activePass ? (
          <>
            <CardHeader>
              <div className="flex min-w-0 items-center gap-2">
                <ScanSearch className="size-4 shrink-0 text-accent" />
                <CardTitle>Code review</CardTitle>
                <Badge variant={reviewing ? 'accent' : 'neutral'} size="sm">{reviewing ? 'reviewing' : 'no review yet'}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-16">
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
                  <span className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--frost)]">
                    <ScanSearch className="size-7 text-[var(--steel)]" />
                  </span>
                  <p className="mt-5 text-sm font-semibold text-ink">Ready for review</p>
                  <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                    Run a code review from the right panel to check the changes.
                  </p>
                </>
              )}
            </CardContent>
          </>
        ) : activePass.findings.length === 0 ? (
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
        ) : (
          <>
            <CardHeader>
              <div className="flex min-w-0 items-center gap-2">
                <CardTitle>{props.projectName} — review</CardTitle>
                {allApplied && <Badge variant="sage" size="sm">applied</Badge>}
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto !p-0">
              <FindingsGrid
                findings={activePass.findings.map(toFinding)}
                applying={applying}
                applied={allApplied}
                readOnly={readOnly}
              />
            </CardContent>

            {!isViewingPast && !allApplied && activePass.findings.length > 0 ? (
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
                <Button size="sm"
                  onClick={() => apply(activePass.passNo)}
                  disabled={readOnly || applying}
                  loading={applying}>
                  Apply findings ({activePass.findings.length})
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      {/* RIGHT — guidance + review rounds */}
      <aside className="flex min-h-0 flex-col gap-4">
        <RailNote icon={<ScanSearch />}>{REVIEW_NOTE}</RailNote>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Review rounds</CardTitle>
            </div>
            <Button
              size="sm"
              onClick={runReview}
              loading={reviewing}
              disabled={readOnly || reviewing || applying}
              leftIcon={<ScanSearch />}
            >
              {reviewing ? 'Reviewing...' : props.passes.length > 0 ? 'Re-run' : 'Run review'}
            </Button>
          </CardHeader>
          {Object.entries(props.buildPrs ?? {}).map(([rid, pr]) => (
            <a key={rid} href={pr.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between border-b border-line px-5 py-2.5 transition-colors hover:opacity-80">
              <span className="text-xs text-ink-faint">Pull request</span>
              <span className="text-sm font-semibold text-accent">{pr.branch} → {pr.targetBranch}</span>
            </a>
          ))}
          <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto !py-4">
            {!reviewing && props.passes.length === 0 ? (
              <div className="flex items-start gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3">
                <ScanSearch className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <p className="text-xs leading-relaxed text-ink-soft">
                  Run a code review to check correctness, security, performance, and style.
                </p>
              </div>
            ) : null}
            {reviewing ? (
              <div className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface-2/60 px-3 py-2.5">
                <Loader2 className="size-4 animate-spin text-accent" />
                <span className="text-sm font-medium text-ink">Pass {props.passes.length + 1}</span>
                <span className="text-xs text-ink-faint">Running…</span>
              </div>
            ) : null}
            {[...props.passes].reverse().map((p) => {
              const isActive = p.passNo === activePassNo && !reviewing;
              const hasApplied = p.appliedIndices.length > 0;
              const hasCritHigh = p.findings.some((f) => f.weight === 'critical' || f.weight === 'high');
              return (
                <div key={p.passNo}>
                  <AuditRoundCard
                    passNo={p.passNo}
                    verdict={p.findings.length === 0 ? 'clean' : hasCritHigh ? 'revised' : 'clean'}
                    findings={p.findings.map(toFinding)}
                    applied={hasApplied}
                    active={isActive}
                    onClick={() => setActivePassNo(p.passNo)}
                  />
                  {applying && isActive ? (
                    <div className="mt-1.5 flex items-center gap-2 rounded-[var(--r-md)] border border-accent/30 bg-accent-tint/30 px-3 py-1.5">
                      <Loader2 className="size-3.5 animate-spin text-accent" />
                      <span className="text-xs font-medium text-accent-deep">
                        Applying {p.findings.length} finding{p.findings.length !== 1 ? 's' : ''}...
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <StageAdvance
              href={`/projects/${props.projectId}/journal`}
              label="Continue to Reflect"
              disabled={readOnly}
              gate
              projectId={props.projectId}
              from="review"
              testId="review-continue-link"
            />
          </CardFooter>
        </Card>
      </aside>
    </div>
    </div>
  );
}
