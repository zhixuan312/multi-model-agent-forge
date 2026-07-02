'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  applyCount?: number;
  buildPrs?: Record<string, { url: string; branch: string; targetBranch: string }>;
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
  const [selectedFindings, setSelectedFindings] = useState<number[]>([]);

  const refresh = useCallback(() => { router.refresh(); }, [router]);
  const mma = useMmaDispatch(props.projectId, {
    onDone: {
      'code-review': refresh,
      'review-apply': refresh,
    },
  });

  const reviewing = props.reviewRunning || mma.busyHandlers.has('code-review');
  const applying = props.applyRunning || mma.busyHandlers.has('review-apply');

  const [auto, setAuto] = useState<'off' | 'running'>('off');
  const [autoNote, setAutoNote] = useState('');

  const activePass = props.passes.find((p) => p.passNo === activePassNo);
  const isViewingPast = activePass && activePass.passNo < props.passes.length;
  const allApplied = activePass ? activePass.appliedIndices.length > 0 : false;

  // Sync to latest pass when new passes arrive
  useEffect(() => {
    if (props.passes.length > 0) setActivePassNo(props.passes[props.passes.length - 1].passNo);
  }, [props.passes.length]);

  // Auto-entry from ?auto=1
  useEffect(() => {
    if (readOnly) return;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      setAutoNote('Starting code review…');
      setAuto('running');
    }
  }, [readOnly]);

  // Automated driver: review loop (5-pass cap) + chain to Reflect
  const autoPassCount = useRef(0);
  useEffect(() => {
    if (auto !== 'running' || readOnly) return;
    const t = setTimeout(() => {
      if (reviewing || applying) return;
      const latestPass = props.passes[props.passes.length - 1];
      if (latestPass && autoPassCount.current < props.passes.length) {
        autoPassCount.current = props.passes.length;
        const hasCritHigh = latestPass.findings.some(
          (f) => f.weight === 'critical' || f.weight === 'high',
        );
        if (hasCritHigh && props.passes.length < 5) {
          setAutoNote(`Review pass ${props.passes.length}/5 — applying ${latestPass.findings.length} findings...`);
          apply(latestPass.passNo, latestPass.findings.map((_, i) => i));
          return;
        }
        if (hasCritHigh && props.passes.length >= 5) {
          setAutoNote('Review cap reached — critical/high findings remain.');
          setAuto('off');
          return;
        }
        // Clean — chain to Reflect
        setAutoNote('Review clean — advancing to Reflect...');
        setTimeout(() => router.push(`/projects/${props.projectId}/journal?auto=1`), 1000);
        return;
      }
      // No review yet or more passes needed — run review
      if (!reviewing) {
        setAutoNote(`Running review pass ${props.passes.length + 1}/5...`);
        void mma.dispatch(`/api/projects/${props.projectId}/review/run`, 'code-review', {});
      }
    }, 1100);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, props.passes.length, reviewing, applying, readOnly]);

  function apply(passNo: number, indices: number[]) {
    if (readOnly || indices.length === 0 || applying) return;
    const pass = props.passes.find((p) => p.passNo === passNo);
    if (!pass) return;
    void mma.dispatch(
      `/api/projects/${props.projectId}/review/apply`,
      'review-apply',
      { passNo, findingIndices: indices },
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <AutomationBar
        mode={auto}
        note={autoNote}
        disabled={readOnly}
        idleHint="Review the code changes, or let Forge run the review automatically."
        runningHint="Forge reviews the code, applies fixes, then advances to Reflect."
        onRun={() => { setAutoNote('Starting review…'); setAuto('running'); }}
        onStop={() => { setAuto('off'); setAutoNote('Stopped.'); }}
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
                selectable
                applying={applying}
                applied={allApplied}
                readOnly={readOnly}
                hideApplyBar
                selectedIndices={selectedFindings}
                onSelectionChange={(indices) => setSelectedFindings(indices)}
              />
            </CardContent>

            {!isViewingPast && !allApplied && activePass.findings.length > 0 ? (
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
                <Button size="sm" variant="ghost" onClick={() => setSelectedFindings(
                  selectedFindings.length === activePass.findings.length ? [] : activePass.findings.map((_: unknown, i: number) => i),
                )} disabled={readOnly || applying}>
                  {selectedFindings.length === activePass.findings.length ? 'Unselect all' : 'Select all'}
                </Button>
                <Button size="sm"
                  onClick={() => apply(activePass.passNo, selectedFindings.length > 0 ? selectedFindings : activePass.findings.map((_: unknown, i: number) => i))}
                  disabled={readOnly || applying || selectedFindings.length === 0}
                  loading={applying}>
                  Apply ({selectedFindings.length || 'all'})
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
              onClick={() => mma.dispatch(`/api/projects/${props.projectId}/review/run`, 'code-review', {})}
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
                    onClick={() => { setActivePassNo(p.passNo); setSelectedFindings([]); }}
                  />
                  {applying && isActive ? (
                    <div className="mt-1.5 flex items-center gap-2 rounded-[var(--r-md)] border border-accent/30 bg-accent-tint/30 px-3 py-1.5">
                      <Loader2 className="size-3.5 animate-spin text-accent" />
                      <span className="text-xs font-medium text-accent-deep">
                        Applying {selectedFindings.length || props.applyCount || 0} finding{(selectedFindings.length || props.applyCount || 0) !== 1 ? 's' : ''}...
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
