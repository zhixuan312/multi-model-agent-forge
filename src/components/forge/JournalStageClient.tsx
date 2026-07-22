'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { showToast } from '@/components/ui/toast';
import {
  ArrowRight,
  Check,
  Loader2,
  Lock,
  NotebookPen,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { AutomationBar } from '@/components/forge/AutomationBar';
import { SummaryPhase } from '@/components/forge/SummaryPhase';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
} from '@/components/ui';
import { DocumentShell } from '@/components/patterns/document-shell';
import { StageShell } from '@/components/patterns/stage-shell';
import { StageNavigator } from '@/components/patterns/stage-navigator';
import { ProseBlock } from '@/components/patterns/prose-block';
import { RailNote } from '@/components/patterns/feature-rail';
import { stagePhaseStore, useStagePhaseUrl } from '@/components/forge/stage-substeps';
import type { LearningCategory, LearningSource } from '@/journal/types';

const JOURNAL_NOTE = `### Journal — capture team knowledge

- **Harvest** — Forge extracts learnings from all stages
- **Curate** — review, refine, approve or remove
- **Record** — approved learnings are saved to the team journal`;

/* ── Types ─────────────────────────────────────────────────────── */

export interface JournalLearningView {
  id: string;
  num: number;
  title: string;
  body: string;
  category: LearningCategory;
  source: LearningSource;
  status: 'proposed' | 'kept' | 'recorded';
  isManual: boolean;
  recordedNodeId?: string | null;
}

export interface JournalStageClientProps {
  projectId: string;
  projectName: string;
  learnings: JournalLearningView[];
  journalMd: string;
  hasJournalFile: boolean;
  harvesting: boolean;
  recording: boolean;
  activeLearningId?: string;
  summary?: import('@/projects/project-summary').ProjectSummary;
  initialPhase?: 'journal' | 'summary';
  readOnly?: boolean;
  /** Why the stage is read-only — shown by AutomationBar. */
  lockedReason?: string;
}

type LearningStatus = 'proposed' | 'kept' | 'recorded';

const CATEGORY_STYLE: Record<LearningCategory, string> = {
  decision: 'bg-accent-tint text-accent',
  design: 'bg-[var(--frost)] text-[var(--steel)]',
  behavior: 'bg-sage-tint text-[var(--sage-deep)]',
  process: 'bg-amber-tint text-[var(--amber)]',
  knowledge: 'bg-rose-tint text-[var(--rose)]',
  style: 'bg-surface-2 text-ink-soft',
};

/* ── Main Component ────────────────────────────────────────────── */

export function JournalStageClient(props: JournalStageClientProps) {
  const router = useRouter();
  const readOnly = props.readOnly ?? false;
  const lockedReason = props.lockedReason;

  type ReflectPhase = 'journal' | 'summary';
  const allRecordedInit = props.learnings.length > 0 && props.learnings.every((l) => l.status === 'recorded');
  const derivedPhase: ReflectPhase = allRecordedInit && props.summary ? 'summary' : 'journal';
  const [phase, setPhaseRaw] = useState<ReflectPhase>(props.initialPhase ?? derivedPhase);
  const setPhase = (p: ReflectPhase) => {
    setPhaseRaw(p);
    const url = new URL(window.location.href);
    url.searchParams.set('phase', p);
    router.push(url.pathname + url.search, { scroll: false });
  };
  // Journal's journal→summary is a VIEW transition only: the resolver drives the
  // journal stage by harvest/approve/record/complete (never an explicit phase
  // advance), so keep this local to match the auto path.
  const advancePhase = (p: ReflectPhase) => {
    setPhase(p);
  };

  useStagePhaseUrl(phase);
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'journal') setPhaseRaw('journal');
        if (key === 'summary' && allRecordedInit && props.summary) setPhaseRaw('summary');
      }),
    [allRecordedInit, props.summary],
  );

  const [activeId, setActiveId] = useState<string>(props.activeLearningId ?? props.learnings[0]?.id ?? '');

  const refresh = useCallback(() => { router.refresh(); }, [router]);
  // dispatch_harvest / dispatch_record are synchronous effects (await:true) — the
  // no-handler transition resolves the POST when their terminal handler recorded
  // the result, so local flags drive button state (no SSE busy-handler).
  const mma = useMmaDispatch(props.projectId, {
    events: {
      'journal.updated': (data) => {
        window.dispatchEvent(new CustomEvent('journal:updated', { detail: data }));
        refresh();
      },
    },
  });

  const [harvestingLocal, setHarvestingLocal] = useState(false);
  const [recordingLocal, setRecordingLocal] = useState(false);
  const shouldAutoHarvest = !props.hasJournalFile && props.learnings.length === 0 && !props.harvesting;
  const harvesting = props.harvesting || harvestingLocal || shouldAutoHarvest;
  const recording = props.recording || recordingLocal;


  const harvestFiredRef = useRef(false);
  function runHarvest() {
    if (harvestingLocal || harvestFiredRef.current) return;
    harvestFiredRef.current = true;
    setHarvestingLocal(true);
    void mma.transition('dispatch_harvest')
      .then(() => refresh())
      .catch(() => { showToast({ type: 'error', message: 'Couldn’t harvest learnings — try again.' }); })
      .finally(() => { harvestFiredRef.current = false; setHarvestingLocal(false); });
  }

  // Auto-trigger harvest when no journal.md exists (like plan auto-triggers author-plan)
  useEffect(() => {
    if (!shouldAutoHarvest) return;
    runHarvest();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = props.learnings.find((l) => l.id === activeId);
  const serverStatus = useMemo(
    () => Object.fromEntries(props.learnings.map((l) => [l.id, l.status])),
    [props.learnings],
  );
  const [localOverrides, setLocalOverrides] = useState<Record<string, LearningStatus>>({});
  const prevServerRef = useRef(serverStatus);
  // eslint-disable-next-line react-hooks/refs -- prop-sync: compare prev server value to reset local overrides during render (React docs pattern)
  if (prevServerRef.current !== serverStatus) {
    // eslint-disable-next-line react-hooks/refs -- prop-sync: store latest server value so the comparison above runs once per change (React docs pattern)
    prevServerRef.current = serverStatus;
    if (Object.keys(localOverrides).length > 0) setLocalOverrides({});
  }
  const status: Record<string, LearningStatus> = { ...serverStatus, ...localOverrides };

  const approvedCount = props.learnings.filter((l) => status[l.id] === 'kept' || status[l.id] === 'recorded').length;
  const allRecorded = props.learnings.length > 0 && props.learnings.every((l) => status[l.id] === 'recorded');
  const isApproved = active ? (status[active.id] === 'kept' || status[active.id] === 'recorded') : false;

  // Must sit with the other hooks, ABOVE every early return below — a useState
  // after the harvesting/!active returns would change the hook count between
  // renders (Rules of Hooks) and crash on the harvest→populated transition.
  const [completing, setCompleting] = useState(false);
  const optimistic = useOptimisticAction();

  // Category groups for right panel
  const categories = useMemo(() => {
    const cats = new Map<string, JournalLearningView[]>();
    for (const l of props.learnings) {
      const arr = cats.get(l.category) ?? [];
      arr.push(l);
      cats.set(l.category, arr);
    }
    return [...cats.entries()];
  }, [props.learnings]);

  function toggleApprove() {
    if (!active || isApproved) return; // approvals are monotonic (approve_learning is one-way)
    const id = active.id;
    const learningIndex = active.num - 1;
    void optimistic.run({
      apply: () => setLocalOverrides((o) => ({ ...o, [id]: 'kept' })),
      commit: () => mma.transition('approve_learning', { learningIndex }),
      rollback: () => setLocalOverrides((o) => { const n = { ...o }; delete n[id]; return n; }),
      onSettled: () => { setLocalOverrides({}); router.refresh(); },
      error: 'Couldn’t approve — reverted.',
      retryable: true,
    });
    // Auto-advance to next unapproved learning
    const nextStatus = { ...status, [id]: 'kept' as const };
    const nextUnapproved = props.learnings.find((l) => nextStatus[l.id] !== 'kept' && nextStatus[l.id] !== 'recorded');
    if (nextUnapproved) setActiveId(nextUnapproved.id);
  }


  // The automation bar belongs to the STAGE, not to one of its internal states. It
  // used to sit only on the final branch, so it vanished on the harvesting, inactive
  // and summary views — the one stage in six that dropped out of the stage flow.
  const automationBar = (
    <AutomationBar
      projectId={props.projectId}
      disabled={readOnly}
      idleHint="Capture learnings from this project, or let Forge extract them automatically."
      lockedReason={lockedReason}
    />
  );

  // Authoring / empty states (like Plan Refine)
  if (harvesting && props.learnings.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
      {automationBar}
      <StageShell
        note={<>
          <RailNote icon={<BookOpen />}>{JOURNAL_NOTE}</RailNote>
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader>
              <CardTitle>Learnings</CardTitle>
              <Button size="sm" disabled leftIcon={<Check />}>Approve all</Button>
            </CardHeader>
            <div className="flex items-center gap-2 border-b border-line px-5 py-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2" />
              <span className="shrink-0 text-xs font-medium text-ink-faint">0/0</span>
            </div>
            <CardContent className="flex min-h-0 flex-1 items-center justify-center">
              <p className="text-xs text-ink-faint">Learnings appear here once harvesting completes.</p>
            </CardContent>
            <CardFooter className="flex-col !items-stretch gap-2">
              <button
                type="button"
                disabled
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--r)] px-4 py-2 text-sm font-medium pointer-events-none cursor-not-allowed bg-ink/30 text-white/50"
              >
                <Lock className="size-4" />
                Record 0 learnings
              </button>
            </CardFooter>
          </Card>
          </>}
      >
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader><CardTitle>Learnings</CardTitle></CardHeader>
          <CardContent className="flex min-h-0 flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="size-6 animate-spin text-accent" />
              <p className="text-sm font-medium text-ink">Harvesting learnings from the project run...</p>
              <p className="text-xs text-ink-soft">Forge extracts learnings from all 6 stages. This takes a moment.</p>
            </div>
          </CardContent>
        </Card>
      </StageShell>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
      {automationBar}
      <StageShell
        note={<RailNote icon={<BookOpen />}>{JOURNAL_NOTE}</RailNote>}
      >
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader><CardTitle>Learnings</CardTitle></CardHeader>
          <CardContent className="flex min-h-0 flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <NotebookPen className="size-8 text-ink-faint" />
              <p className="text-sm font-medium text-ink">No learnings yet</p>
              <p className="text-xs text-ink-soft">Harvest AI learnings from the project run, or add your own.</p>
              <Button
                size="sm"
                onClick={runHarvest}
                disabled={readOnly || harvesting}
                loading={harvesting}
                leftIcon={<NotebookPen />}
              >
                Harvest learnings
              </Button>
            </div>
          </CardContent>
        </Card>
      </StageShell>
      </div>
    );
  }

  if (phase === 'summary' && props.summary) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        {automationBar}
        <SummaryPhase
          summary={props.summary}
          projectId={props.projectId}
          readOnly={readOnly}
          completing={completing}
          onMarkComplete={() => {
            setCompleting(true);
            void mma.transition('mark_complete')
              .then(() => router.refresh())
              .catch(() => { showToast({ type: 'error', message: 'Couldn’t mark the project complete — try again.' }); })
              .finally(() => setCompleting(false));
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {automationBar}
    <StageShell
      note={<RailNote icon={<BookOpen />}>{JOURNAL_NOTE}</RailNote>}
      navigator={
        <StageNavigator
          className="flex-1"
          title="Learnings"
          action={
            <Button
              size="sm"
              onClick={() => {
                // Approve every not-yet-kept learning (monotonic; no revoke-all).
                const pending = props.learnings.filter((l) => status[l.id] !== 'kept' && status[l.id] !== 'recorded');
                if (pending.length === 0) return;
                void optimistic.run({
                  apply: () => setLocalOverrides((o) => {
                    const next = { ...o };
                    for (const l of pending) next[l.id] = 'kept';
                    return next;
                  }),
                  commit: () => Promise.all(pending.map((l) => mma.transition('approve_learning', { learningIndex: l.num - 1 }))),
                  rollback: () => setLocalOverrides((o) => {
                    const next = { ...o };
                    for (const l of pending) delete next[l.id];
                    return next;
                  }),
                  onSettled: () => { setLocalOverrides({}); router.refresh(); },
                  error: 'Couldn’t approve all — reverted.',
                  retryable: true,
                });
              }}
              disabled={readOnly || props.learnings.length === 0 || approvedCount === props.learnings.length}
              leftIcon={<Check />}
            >
              Approve all
            </Button>
          }
          progress={{ value: approvedCount, total: props.learnings.length }}
          showChecks
          groups={categories.map(([cat, items]) => ({
            id: cat,
            label: cat,
            items: items.map((l) => ({
              id: l.id,
              title: l.title,
              meta: (
                <span className="flex items-center gap-2">
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold', CATEGORY_STYLE[l.category])}>{l.category}</span>
                  <span>{l.source}</span>
                </span>
              ),
              index: l.num,
              done: status[l.id] === 'kept' || status[l.id] === 'recorded',
              active: l.id === activeId,
              onClick: () => setActiveId(l.id),
            })),
          }))}
          footer={
            // A phase advance WITHIN the stage (journal → summary), not a stage
            // advance — so it's the accent Button its peers use ("Continue to
            // Finalize" / "Validate" / "Implement"), not the ink StageAdvance.
            <Button
              className="w-full"
              loading={recording}
              rightIcon={<ArrowRight />}
              disabled={approvedCount === 0 || readOnly}
              onClick={() => {
                if (!allRecorded && approvedCount > 0) {
                  setRecordingLocal(true);
                  void mma.transition('dispatch_record')
                    .then(() => refresh())
                    .catch(() => { showToast({ type: 'error', message: 'Couldn’t record to the journal — try again.' }); })
                    .finally(() => setRecordingLocal(false));
                }
                advancePhase('summary');
              }}
            >
              {recording ? 'Recording…' : 'Continue to Summary'}
            </Button>
          }
        />
      }
    >
      {/* LEFT PANEL — the learning document. */}
      <DocumentShell
        className="flex min-h-0 flex-1 flex-col"
        meta={
          <>
            <Badge variant="neutral" size="sm">Learning {active.num}</Badge>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CATEGORY_STYLE[active.category])}>{active.category}</span>
          </>
        }
        title={active.title}
        body={
          <ProseBlock>
            {active.body}
          </ProseBlock>
        }
        actions={
          isApproved ? (
            // Approvals are monotonic (approve_learning is one-way) — show a static
            // confirmed state, not a Revoke affordance the model cannot honor.
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft">
              <Check className="size-4 text-accent" /> Approved
            </span>
          ) : (
            <Button size="sm" onClick={toggleApprove} disabled={readOnly} variant="primary" leftIcon={<Check />}>
              Approve
            </Button>
          )
        }
      />
    </StageShell>
    </div>
  );
}
