'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';
import { useServerState } from '@/hooks/useServerState';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Lock,
  Shield,
  Sparkles,
  GitBranch,
  ListTree,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { AutomationBar, type AutoMode } from '@/components/forge/AutomationBar';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { cn } from '@/lib/cn';
import { ProseBlock } from '@/components/patterns/prose-block';
import { ForgeMark } from '@/components/forge/ForgeMark';
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
  Micro,
  Eyebrow,
} from '@/components/ui';
import { useRouter } from 'next/navigation';
import { ConversationComposer } from '@/components/patterns/conversation';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import type { ProjectPhase } from '@/db/enums';
import type { PlanPhaseSeed, PlanTaskSeed, PlanAuditFinding } from '@/build/plan-types';
import { FindingsGrid, AuditRoundCard as PatternAuditRoundCard, type Finding } from '@/components/patterns/findings';
import { RailNote } from '@/components/patterns/feature-rail';

const PLAN_PHASE_NOTES: Record<string, string> = {
  refine: `### Refine — review the tasks

- **Select** a task from the right to see its full breakdown
- **Ask questions** — refine the approach through conversation
- **Approve** each task to confirm the approach
- **All approved** → unlocks the validation audit

### What a task contains

- The heading from the plan markdown
- Implementation detail, file paths, test strategy
- One repo target per task`,

  validate: `### Validate — audit the plan

- **Run audit** — MMA checks sequencing, coverage, and TDD gaps
- **Select findings** — pick which to apply, or apply all at once
- **Re-audit** — run again after fixes to verify
- **Lock** — once audit is clean, lock the plan for execution

### What the audit checks

- Task ordering and dependencies
- Missing test coverage
- Gaps between spec requirements and plan tasks`,
};

type PlanPhase = 'refine' | 'validate';
type TaskStatus = 'proposed' | 'detailed' | 'approved';

type Msg =
  | { id: string; role: 'forge' | 'user'; text: string }
  | { id: string; role: 'audit'; passNo: number; verdict: 'clean' | 'revised'; findings: PlanAuditFinding[] }
  | { id: string; role: 'draft'; md: string; version: number };

export interface PlanStageClientProps {
  projectId: string;
  projectName: string;
  intentMd: string;
  phase: ProjectPhase;
  mmaReady: boolean;
  phases: PlanPhaseSeed[];
  planMd: string;
  auditRounds: PlanAuditFinding[][];
  auditApplied?: boolean[];
  voiceEnabled?: boolean;
  pendingAuthor?: string | null;
  pendingAudit?: string | null;
  pendingApply?: string | null;
  initialPhase?: 'refine' | 'validate';
}

let _id = 0;
const nid = () => `pm${_id++}`;

/** The task's number (id `t8` → 8) -- matches the "Task N" used in dependsOn. */
const taskNum = (id: string) => Number(id.replace(/\D/g, '')) || 0;

export function PlanStageClient(props: PlanStageClientProps) {
  const router = useRouter();
  const readOnly = props.phase !== 'design';
  const allTasks = useMemo(() => props.phases.flatMap((p) => p.tasks), [props.phases]);

  const derivedPhase: PlanPhase = (() => {
    if (props.auditRounds.length > 0) return 'validate';
    const allApprovedInit = allTasks.length > 0 && allTasks.every((t) => t.dbStatus === 'committed' || t.dbStatus === 'approved');
    if (allApprovedInit) return 'validate';
    return 'refine';
  })();
  const safeInitial = props.initialPhase === 'validate' && allTasks.length === 0 ? undefined : props.initialPhase;
  const [phase, setPhaseRaw] = useState<PlanPhase>(safeInitial ?? derivedPhase);

  const setPhase = (p: PlanPhase) => {
    setPhaseRaw(p);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('phase', p);
      router.push(url.pathname + url.search, { scroll: false });
      fetch(`/api/projects/${props.projectId}/phase`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'plan', phase: p }),
      }).catch(() => {});
    }
  };
  const [status, setStatus] = useState<Record<string, TaskStatus>>(
    () => Object.fromEntries(allTasks.map((t) => [t.id, (t.dbStatus === 'committed' || t.dbStatus === 'approved' ? 'approved' : 'proposed') as TaskStatus])),
  );
  const initialRounds = useMemo(
    () => props.auditRounds.map((findings, i) => {
      const hasCritHigh = findings.some((f) => f.severity === 'critical' || f.severity === 'high');
      return { passNo: i + 1, verdict: hasCritHigh ? 'revised' as const : 'clean' as const, findings };
    }),
    [props.auditRounds],
  );
  const [rounds] = useServerState(initialRounds);
  const [locked, setLocked] = useState(false);
  const [applying, setApplying] = useState(!!props.pendingApply);
  const [applyingPass, setApplyingPass] = useState<number | null>(null);
  const [appliedPasses, setAppliedPasses] = useState<Set<number>>(
    () => new Set((props.auditApplied ?? []).flatMap((v, i) => v ? [i + 1] : [])),
  );

  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');

  const refresh = useCallback(() => { router.refresh(); }, [router]);
  const mma = useMmaDispatch(props.projectId, {
    onDone: {
      'plan-author': refresh,
      'plan-audit': refresh,
      'plan-audit-apply': refresh,
      'plan-refine': refresh,
    },
    events: {
      'plan.updated': (data) => {
        window.dispatchEvent(new CustomEvent('plan:updated', { detail: data }));
        refresh();
      },
    },
  });
  const authoring = !!props.pendingAuthor || mma.busyHandlers.has('plan-author');

  // Auto-trigger plan authoring if no plan exists yet
  const authorFired = useRef(false);
  useEffect(() => {
    if (authorFired.current || readOnly || allTasks.length > 0 || props.pendingAuthor) return;
    authorFired.current = true;
    void mma.dispatch(`/projects/${props.projectId}/build/author-plan`, 'plan-author')
      .catch(() => {});
  }, [readOnly, allTasks.length, props.pendingAuthor, props.projectId, mma, router]);

  useEffect(() => stagePhaseStore.set(phase), [phase]);
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'refine' || key === 'validate') setPhase(key as PlanPhase);
      }),
    [],
  );

  // Arriving in automated mode (?auto=1, e.g. from Spec Document) → keep driving.
  useEffect(() => {
    if (readOnly) return;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      setAutoNote('Forge is driving -- decomposing the spec...');
      setAuto('running');
    }
  }, [readOnly]);

  const approvedCount = allTasks.filter((t) => status[t.id] === 'approved').length;
  const allApproved = allTasks.length > 0 && approvedCount === allTasks.length;
  const auditClean = rounds[rounds.length - 1]?.verdict === 'clean';

  const auditing = !!props.pendingAudit || mma.busyHandlers.has('plan-audit');
  const auditingRef = useRef(false);

  function runAudit() {
    if (auditingRef.current) return;
    auditingRef.current = true;
    void mma.dispatch(`/projects/${props.projectId}/build/run-audit`, 'plan-audit')
      .then(() => { auditingRef.current = false; })
      .catch(() => { auditingRef.current = false; });
  }

  const applyFindings = useCallback((findings: PlanAuditFinding[], passNo?: number) => {
    setApplying(true);
    if (passNo) setApplyingPass(passNo);
    void mma.dispatch(`/projects/${props.projectId}/plan/audit-apply`, 'plan-audit-apply', { findings })
      .then(() => {
        setApplying(false);
        if (passNo) setAppliedPasses((prev) => new Set(prev).add(passNo));
        setApplyingPass(null);
      })
      .catch(() => { setApplying(false); setApplyingPass(null); });
  }, [mma, props.projectId]);

  // ── Automated-mode driver. The on-screen plan IS the shared state, so Stop
  // hands the wheel back mid-flight and Run resumes from exactly here.
  useEffect(() => {
    // NB: don't bail on `locked` -- once locked, the final step is to navigate
    // into Execute, which still needs to run.
    if (auto !== 'running' || readOnly) return;
    const t = setTimeout(() => {
      if (phase === 'refine') {
        const next = allTasks.find((tk) => status[tk.id] !== 'approved');
        if (next) {
          setAutoNote('Drafted & approved: ' + next.title);
          setStatus((s) => ({ ...s, [next.id]: 'approved' }));
        } else {
          setAutoNote('All tasks drafted -- validating the plan...');
          setPhase('validate');
        }
      } else if (phase === 'validate') {
        if (!auditClean && !auditingRef.current) {
          setAutoNote('Ran audit pass ' + (rounds.length + 1) + ' -- applied critical/high fixes.');
          runAudit();
        } else if (!locked) {
          setAutoNote('Critical & high cleared -- locking the plan, on to Build.');
          setLocked(true);
        } else {
          // Plan is locked -- carry the automated run into the Execute stage.
          router.push(`/projects/${props.projectId}/execute?auto=1`);
        }
      }
    }, 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, phase, status, rounds, auditClean, locked, readOnly]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="plan-stage">
      {!props.mmaReady ? (
        <Banner
          variant="warning"
          title="The MMA token is not configured."
          description={
            <>
              <a href="/settings/connections" className="font-medium underline">
                Configure the MMA token
              </a>{' '}
              to audit and execute the plan.
            </>
          }
        />
      ) : null}

      <AutomationBar
        mode={auto}
        note={autoNote}
        disabled={readOnly || locked}
        onRun={() => {
          setAutoNote('Forge is driving -- reviewing the decomposition...');
          setAuto('running');
        }}
        onStop={() => {
          setAuto('off');
          setAutoNote('Stopped -- you have the wheel.');
        }}
      />

      {phase === 'refine' ? (
        <DetailStage
          projectId={props.projectId}
          phases={props.phases}
          status={status}
          readOnly={readOnly}
          driving={auto === 'running'}
          authoring={authoring}
          voiceEnabled={props.voiceEnabled}
          approvedCount={approvedCount}
          allApproved={allApproved}
          mma={mma}
          onToggleApprove={(id) => { const next = status[id] === 'approved' ? 'proposed' : 'approved'; setStatus((s) => ({ ...s, [id]: next as TaskStatus })); fetch(`/projects/${props.projectId}/plan/tasks/${id}/approve`, { method: next === 'approved' ? 'POST' : 'DELETE' }).catch(() => {}); }}
          onValidate={() => setPhase('validate')}
        />
      ) : (
        <ValidateStage
          projectId={props.projectId}
          projectName={props.projectName}
          planMd={props.planMd}
          readOnly={readOnly}
          mmaReady={props.mmaReady}
          driving={auto === 'running'}
          voiceEnabled={props.voiceEnabled}
          auditing={auditing}
          applying={applying}
          appliedPasses={appliedPasses}
          onApplyFindings={applyFindings}
          rounds={rounds}
          locked={locked}
          auditClean={auditClean}
          onRunAudit={runAudit}
          onLock={async () => {
            setLocked(true);
            await fetch(`/api/projects/${props.projectId}/advance`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: 'plan' }),
            });
            router.push(`/projects/${props.projectId}/execute`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ── Shared chat primitives (same language as the Spec stage) ───────────────── */
function ChatForge({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <ForgeMark className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-semibold text-ink">Forge</span>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

function ChatUser({ text }: { text: string }) {
  return (
    <div className="flex flex-row-reverse gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sage-tint text-[11px] font-semibold text-[var(--sage-deep)]">
        AD
      </span>
      <div className="flex min-w-0 max-w-[88%] flex-col items-end">
        <span className="mb-1 text-[11px] text-ink-faint">You</span>
        <div className="rounded-2xl rounded-tr-md border border-accent/20 bg-accent-tint px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          {text}
        </div>
      </div>
    </div>
  );
}

/** A (re)constructed plan posted into the conversation as a versioned artifact. */
function PlanDraftBubble({ md, version }: { md: string; version: number }) {
  return (
    <div className="flex gap-2.5">
      <ForgeMark className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink">Forge</span>
          <Badge variant="sage" size="sm">
            plan · v{version}
          </Badge>
        </div>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
          <div className="max-h-[44vh] overflow-y-auto pr-1">
            <ProseBlock className="max-w-none prose-headings:mb-1.5 prose-headings:mt-4 first:prose-headings:mt-0">{md}</ProseBlock>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ComposerAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function PlanComposer({
  value,
  onChange,
  onSend,
  secondaries,
  placeholder,
  disabled,
  voiceEnabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  secondaries?: ComposerAction[];
  placeholder: string;
  disabled: boolean;
  voiceEnabled?: boolean;
}) {
  return (
    <ConversationComposer
      value={value}
      onChange={onChange}
      onSend={() => onSend()}
      disabled={disabled}
      placeholder={placeholder}
      voice={voiceEnabled ?? false}
      secondaryActions={
        secondaries && secondaries.length > 0 ? (
          <div className="flex items-center gap-2">
            {secondaries.map((s, i) => (
              <Button key={i} size="sm" variant="ghost" onClick={s.onClick} disabled={disabled || s.disabled} leftIcon={s.icon}>
                {s.label}
              </Button>
            ))}
          </div>
        ) : undefined
      }
    />
  );
}
function TaskRow({ task, index }: { task: PlanTaskSeed; index: number }) {
  const num = task.num || index + 1;
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] bg-accent-tint font-mono text-[10px] font-semibold text-accent">
          {num}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug text-ink">{task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-ink-faint">
            <span className="inline-flex items-center gap-1">
              <GitBranch className="size-2.5" /> {task.targetRepo}
            </span>
            {task.dependsOn.length > 0 ? <span>· deps {task.dependsOn.join(', ')}</span> : null}
          </div>
        </div>
      </div>
    </li>
  );
}

/* ── Detail -- per-task dialogue (like Craft) ────────────────────────────────── */
function DetailStage({
  projectId,
  phases,
  status,
  readOnly,
  driving,
  authoring,
  voiceEnabled,
  approvedCount,
  allApproved,
  mma,
  onToggleApprove,
  onValidate,
}: {
  projectId: string;
  phases: PlanPhaseSeed[];
  status: Record<string, TaskStatus>;
  readOnly: boolean;
  driving: boolean;
  authoring?: boolean;
  voiceEnabled?: boolean;
  approvedCount: number;
  allApproved: boolean;
  mma: ReturnType<typeof useMmaDispatch>;
  onToggleApprove: (id: string) => void;
  onValidate: () => void;
}) {
  const allTasks = phases.flatMap((p) => p.tasks);
  const firstOpen = allTasks.find((t) => status[t.id] !== 'approved') ?? allTasks[0];
  const [activeId, setActiveId] = useState<string>(firstOpen?.id ?? '');
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = allTasks.find((t) => t.id === activeId) ?? allTasks[0];
  const phaseOf = phases.find((p) => p.tasks.some((t) => t.id === active?.id));

  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'end' }), [threads, activeId]);

  // Follow the AI as it auto-approves.
  useEffect(() => {
    if (active && status[active.id] === 'approved') {
      const next = allTasks.find((t) => status[t.id] !== 'approved');
      if (next) setActiveId(next.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const [refining, setRefining] = useState(false);
  const [taskView, setTaskView] = useState<'plan' | 'discussion'>('plan');

  useEffect(() => {
    function onPlanUpdated(e: Event) {
      const detail = (e as CustomEvent).detail as { taskId?: string; chatReply?: string } | undefined;
      if (!detail?.taskId || !detail?.chatReply) return;
      setRefining(false);
      setThreads((th) => ({
        ...th,
        [detail.taskId!]: [...(th[detail.taskId!] ?? []), { id: nid(), role: 'forge', text: detail.chatReply! }],
      }));
    }
    window.addEventListener('plan:updated', onPlanUpdated);
    return () => window.removeEventListener('plan:updated', onPlanUpdated);
  }, []);

  if (authoring && allTasks.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        <Card className="flex min-h-0 flex-col lg:col-span-2">
          <CardHeader>
            <CardTitle>Plan tasks</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1">
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
              <Loader2 className="size-6 animate-spin text-accent" />
              <p className="text-sm font-medium text-ink">Authoring plan from locked spec...</p>
              <p className="text-xs text-ink-soft">Forge writes the implementation plan from the locked spec. This takes a moment.</p>
            </div>
          </CardContent>
        </Card>
        <aside className="flex min-h-0 flex-col">
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader><CardTitle>Task list</CardTitle></CardHeader>
            <CardContent className="min-h-0 flex-1">
              <div className="grid h-full place-items-center">
                <div className="flex flex-col items-center gap-2 text-ink-faint">
                  <Loader2 className="size-5 animate-spin text-accent" />
                  <span className="text-xs">Authoring plan...</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        <Card className="flex min-h-0 flex-col lg:col-span-2">
          <CardHeader><CardTitle>Plan tasks</CardTitle></CardHeader>
          <CardContent className="min-h-0 flex-1">
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
              <ListTree className="size-8 text-ink-faint" />
              <p className="text-sm font-medium text-ink">No plan yet</p>
              <p className="text-xs text-ink-soft">The plan is authored from the locked spec. Make sure a repo is linked to the project.</p>
              <Button
                size="sm"
                onClick={() => {
                  void mma.dispatch(`/projects/${projectId}/build/author-plan`, 'plan-author').catch(() => {});
                }}
                disabled={readOnly}
                leftIcon={<Sparkles />}
              >
                Author plan
              </Button>
            </div>
          </CardContent>
        </Card>
        <aside className="flex min-h-0 flex-col">
          <RailNote icon={<ListTree />}>{PLAN_PHASE_NOTES.refine}</RailNote>
        </aside>
      </div>
    );
  }
  const approved = status[active?.id ?? ''] === 'approved';
  const msgs = threads[active?.id ?? ''] ?? [];

  function send() {
    const text = input.trim();
    if (!text || refining) return;
    setInput('');
    setThreads((th) => ({
      ...th,
      [active.id]: [...(th[active.id] ?? []), { id: nid(), role: 'user', text }],
    }));
    setRefining(true);
    void mma.dispatch(
      `/projects/${projectId}/plan/tasks/${active.id}/refine`,
      'plan-refine',
      { message: text },
    ).catch(() => {
      setRefining(false);
      setThreads((th) => ({
        ...th,
        [active.id]: [...(th[active.id] ?? []), { id: nid(), role: 'forge', text: 'The refinement failed — try again or approve as-is.' }],
      }));
    });
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE -- plan view / discussion toggle (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="neutral" size="sm">
              Task {active?.num || 0}
            </Badge>
            <CardTitle>{active?.title ?? ''}</CardTitle>
          </div>
          <div className="flex items-center rounded-[var(--r)] border border-line bg-surface-2 p-0.5">
            {(['plan', 'discussion'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setTaskView(v)}
                className={cn(
                  'rounded-[6px] px-3 py-1 text-xs font-medium transition-colors',
                  taskView === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink',
                )}
              >
                {v === 'plan' ? 'Plan' : 'Discussion'}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto bg-surface-2/40 !py-5">
          {taskView === 'plan' ? (
            <ProseBlock className="max-w-none prose-headings:mb-1.5 prose-headings:mt-4 first:prose-headings:mt-0">
              {active.body}
            </ProseBlock>
          ) : (
            <div className="space-y-5">
              {msgs.length === 0 ? (
                <p className="py-8 text-center text-xs text-ink-faint">No discussion yet — send a message to refine this task.</p>
              ) : null}
              {msgs.map((m) => (m.role === 'user' ? <ChatUser key={m.id} text={m.text} /> : <ChatForge key={m.id}>{(m as { text: string }).text}</ChatForge>))}
              {refining ? (
                <ChatForge>
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin text-accent" /> Thinking…
                  </span>
                </ChatForge>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </CardContent>
        {taskView === 'plan' ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Button
              size="sm"
              onClick={() => onToggleApprove(active.id)}
              disabled={readOnly}
              variant={approved ? 'secondary' : 'primary'}
              leftIcon={approved ? <RotateCcw /> : <Check />}
            >
              {approved ? 'Revoke' : 'Approve'}
            </Button>
          </div>
        ) : (
          <PlanComposer
            value={input}
            onChange={setInput}
            onSend={send}
            placeholder="Discuss the approach..."
            disabled={readOnly || driving || refining}
            voiceEnabled={voiceEnabled}
          />
        )}
      </Card>

      {/* RIGHT -- guidance + every task grouped by phase + move-on (1/3) */}
      <aside className="flex min-h-0 flex-col gap-4">
        <RailNote icon={<ListTree />}>{PLAN_PHASE_NOTES.refine}</RailNote>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <span className="text-sm font-medium text-ink-faint">
              {approvedCount}/{allTasks.length}
            </span>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-3">
            <div className="h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-[var(--sage)] transition-all" style={{ width: `${allTasks.length ? (approvedCount / allTasks.length) * 100 : 0}%` }} />
            </div>
            {phases.map((p) => (
              <div key={p.id} className="space-y-2">
                {phases.length > 1 ? (
                  <Micro className="block !font-semibold !uppercase !tracking-wide !text-ink-faint">{p.title}</Micro>
                ) : null}
                {p.tasks.map((t) => {
                  const isActive = t.id === active?.id;
                  const isApproved = status[t.id] === 'approved';
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveId(t.id)}
                      className={cn(
                        'flex w-full gap-2.5 rounded-[var(--r-md)] border p-2.5 text-left transition-colors',
                        isActive
                          ? 'border-accent bg-accent-tint/25 shadow-sm'
                          : isApproved
                            ? 'border-[var(--sage-deep)]/30 bg-sage-tint/20 hover:bg-sage-tint/40'
                            : 'border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-[6px] text-[10px] font-semibold transition-colors',
                          isApproved
                            ? 'bg-[var(--sage-deep)] text-white'
                            : isActive
                              ? 'bg-accent text-white'
                              : 'bg-surface-2 text-ink-faint',
                        )}
                      >
                        {isApproved ? <Check className="size-3.5" /> : (t.num || 0)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium leading-snug text-ink">{t.title}</p>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-faint">
                          <span className="inline-flex items-center gap-0.5">
                            <GitBranch className="size-2.5" /> {t.targetRepo}
                          </span>
                          {t.files.length > 0 ? <span>{t.files.length} files</span> : null}
                          {t.dependsOn.length > 0 ? <span>· deps {t.dependsOn.length}</span> : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={onValidate} disabled={!allApproved} rightIcon={<ArrowRight />}>
              Validate the plan
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/* ── Validate -- the Spec audit chat, applied to the plan ────────────────────── */
function ValidateStage({
  projectId,
  projectName,
  planMd,
  readOnly,
  mmaReady,
  driving,
  voiceEnabled,
  auditing,
  applying,
  appliedPasses,
  onApplyFindings,
  rounds,
  locked,
  auditClean,
  onRunAudit,
  onLock,
}: {
  projectId: string;
  projectName: string;
  planMd: string;
  readOnly: boolean;
  mmaReady: boolean;
  driving: boolean;
  voiceEnabled?: boolean;
  auditing?: boolean;
  applying: boolean;
  appliedPasses: Set<number>;
  onApplyFindings: (findings: PlanAuditFinding[], passNo?: number) => void;
  rounds: { passNo: number; verdict: 'clean' | 'revised'; findings: PlanAuditFinding[] }[];
  locked: boolean;
  auditClean: boolean;
  onRunAudit: () => void;
  onLock: () => void;
}) {
  const md = planMd;
  const [version, setVersion] = useState(1);
  const [docView, setDocView] = useState<'conversation' | 'document'>(planMd ? 'document' : 'conversation');
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    const initial: Msg[] = [
      { id: nid(), role: 'forge', text: "The plan is ready. Run an audit to check sequencing, coverage and TDD gaps; discuss changes; then lock it." },
    ];
    for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i];
      if (r.findings.length > 0) {
        initial.push({ id: nid(), role: 'audit', passNo: r.passNo, verdict: r.verdict, findings: r.findings });
      }
    }
    return initial;
  });
  const [input, setInput] = useState('');
  const seen = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'end' }), [msgs]);

  // Post each new audit round into the conversation.
  useEffect(() => {
    if (rounds.length <= seen.current) return;
    const fresh = rounds.slice(seen.current);
    seen.current = rounds.length;
    setMsgs((m) => [
      ...m,
      ...fresh.flatMap((r) => [
        { id: nid(), role: 'audit', passNo: r.passNo, verdict: r.verdict, findings: r.findings } as Msg,
        {
          id: nid(),
          role: 'forge',
          text: r.verdict === 'clean' ? 'Clean pass -- no critical or high. You can lock the plan.' : 'Pick the findings to apply, or tell me by number -- I will revise the plan and you re-run.',
        } as Msg,
      ]),
    ]);
  }, [rounds]);


  function apply(passNo: number, indices: number[], total: number) {
    if (readOnly || indices.length === 0 || applying) return;
    const round = rounds.find((r) => r.passNo === passNo);
    if (!round) return;
    const selectedFindings = indices.map((i) => round.findings[i]).filter(Boolean);
    const label = indices.length === total ? `all ${total} findings` : `finding${indices.length === 1 ? '' : 's'} #${indices.map((i) => i + 1).sort((a, b) => a - b).join(', #')}`;
    setMsgs((m) => [...m, { id: nid(), role: 'forge', text: `Revising the plan to address ${label} from pass ${passNo}...` }]);
    onApplyFindings(selectedFindings, passNo);
  }
  function replay(passNo: number) {
    const round = rounds.find((r) => r.passNo === passNo);
    if (!round) return;
    setDocView('conversation');
    setMsgs((m) => [
      ...m,
      { id: nid(), role: 'forge', text: `Here are the pass ${passNo} findings again -- select the ones to apply.` },
      { id: nid(), role: 'audit', passNo: round.passNo, verdict: round.verdict, findings: round.findings },
    ]);
  }
  function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMsgs((m) => [...m, { id: nid(), role: 'user', text }, { id: nid(), role: 'forge', text: 'Noted -- hit Construct plan to regenerate it, or re-run the audit.' }]);
  }
  function reconstruct() {
    if (readOnly) return;
    const v = version + 1;
    setVersion(v);
    setMsgs((m) => [
      ...m,
      { id: nid(), role: 'forge', text: `Re-constructed the plan from our discussion -- v${v}.` },
    ]);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE -- finalize the plan in dialogue (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle>{projectName} -- validate the plan</CardTitle>
            {locked ? (
              <Badge variant="sage" size="sm">
                <Lock className="mr-1 size-3" /> locked
              </Badge>
            ) : null}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
            TDD · engineer-facing
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto bg-surface-2/40 !py-5">
          {docView === 'document' && md ? (
            <div className="flex gap-2.5">
              <ForgeMark className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-ink">Forge</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-[10px] font-medium text-accent-deep">plan . v{version}</span>
                </div>
                <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
                  <ProseBlock>{md}</ProseBlock>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {msgs.filter((m) => m.role !== 'draft').map((m) =>
                m.role === 'user' ? (
                  <ChatUser key={m.id} text={m.text} />
                ) : m.role === 'audit' ? (
                  <AuditChatMsg key={m.id} passNo={m.passNo} verdict={m.verdict} findings={m.findings} readOnly={readOnly} applying={applying} applied={appliedPasses.has(m.passNo)} onApply={(idx) => apply(m.passNo, idx, m.findings.length)} />
                ) : (
                  <ChatForge key={m.id}>{(m as { text: string }).text}</ChatForge>
                ),
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </CardContent>
        {docView === 'document' ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3">
            <div className="flex items-center gap-2.5">
              <ListTree className="size-5 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Plan v{version}</p>
                <p className="text-xs text-ink-faint">Review the plan, or go back to refine.</p>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setDocView('conversation')}>
              Back to conversation
            </Button>
          </div>
        ) : (
          <PlanComposer
            value={input}
            onChange={setInput}
            onSend={send}
            secondaries={[
              { label: version > 1 ? 'Re-construct plan' : 'Construct plan', icon: <Sparkles />, onClick: () => { reconstruct(); setDocView('document'); }, disabled: readOnly || locked },
            ]}
            placeholder="Discuss the plan..."
            disabled={readOnly || driving}
            voiceEnabled={voiceEnabled}
          />
        )}
        {!mmaReady ? (
          <div className="shrink-0 border-t border-line px-5 py-2">
            <TextSm className="!text-[var(--amber)]">
              <a href="/settings/connections" className="underline">Configure the MMA token</a> to run the audit.
            </TextSm>
          </div>
        ) : null}
      </Card>

      {/* RIGHT -- guidance + audit rounds + Lock the plan (1/3) */}
      <aside className="flex min-h-0 flex-col gap-4">
        <RailNote icon={<ListTree />}>{PLAN_PHASE_NOTES.validate}</RailNote>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Audit rounds</CardTitle>
              {rounds.length > 0 ? <span className="text-sm font-medium text-ink-faint">{rounds.length}</span> : null}
            </div>
            <Button
              size="sm"
              onClick={onRunAudit}
              loading={!!auditing}
              disabled={readOnly || !mmaReady || locked || !!auditing || applying}
              leftIcon={<Shield />}
            >
              {auditing ? 'Auditing...' : rounds.length > 0 ? 'Re-run' : 'Run audit'}
            </Button>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto !py-4">
            {auditing ? (
              <div className="w-full rounded-[var(--r-md)] border border-line bg-surface p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">Pass {rounds.length + 1}</span>
                  <Badge variant="neutral" size="sm">running</Badge>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin text-accent" />
                  <span className="text-xs text-ink-soft">Auditing plan...</span>
                </div>
              </div>
            ) : rounds.length === 0 ? (
              <div className="flex items-start gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3">
                <Shield className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <p className="text-xs leading-relaxed text-ink-soft">
                  Run an audit to check sequencing, coverage and TDD gaps.
                </p>
              </div>
            ) : null}
            {[...rounds].reverse().map((r) => <PatternAuditRoundCard key={r.passNo} passNo={r.passNo} verdict={r.verdict} findings={r.findings as Finding[]} applied={appliedPasses.has(r.passNo)} onClick={() => replay(r.passNo)} />)}
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <TextSm className="!text-ink-faint">
              {auditClean
                ? 'Clean audit -- locking opens Build and runs the plan task-by-task.'
                : 'Locking opens Build and starts Execution. Open findings will not block it.'}
            </TextSm>
            <StageAdvance
              onClick={onLock}
              label={locked ? 'Opening Build...' : 'Lock the plan & start Build'}
              disabled={readOnly || locked}
              gate
              testId="plan-lock-button"
            />
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/* ── audit message: uses FindingsGrid + AuditRoundCard from patterns ──── */

function AuditChatMsg({
  passNo,
  verdict,
  findings,
  readOnly,
  applying,
  applied,
  onApply,
}: {
  passNo: number;
  verdict: 'clean' | 'revised';
  findings: PlanAuditFinding[];
  readOnly: boolean;
  applying?: boolean;
  applied?: boolean;
  onApply: (indices: number[]) => void;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[var(--frost)] text-[var(--steel)]">
        <Shield className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink">Audit</span>
          <span className="text-[11px] text-ink-faint">pass {passNo}</span>
          <Badge variant={verdict === 'clean' ? 'sage' : 'neutral'} size="sm">
            {verdict === 'clean' ? 'clean' : `${findings.length} finding${findings.length === 1 ? '' : 's'} → revised`}
          </Badge>
          {applied ? <Badge variant="sage" size="sm">applied</Badge> : applying ? <Badge variant="neutral" size="sm">applying...</Badge> : null}
        </div>
        <FindingsGrid
          findings={findings as Finding[]}
          selectable
          applying={applying}
          applied={applied}
          readOnly={readOnly}
          onApply={onApply}
          appliedLabel='All findings applied -- press "Construct plan" to re-assemble.'
        />
      </div>
    </div>
  );
}
