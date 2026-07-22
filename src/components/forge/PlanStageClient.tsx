'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';
import { useServerState } from '@/hooks/useServerState';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { showToast } from '@/components/ui/toast';
import {
  ArrowRight,
  Check,
  Lock,
  Shield,
  Sparkles,
  GitBranch,
  ListTree,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { AutomationBar } from '@/components/forge/AutomationBar';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { DocumentShell, type DocumentShellTab } from '@/components/patterns/document-shell';
import { StageShell } from '@/components/patterns/stage-shell';
import { StageNavigator } from '@/components/patterns/stage-navigator';
import { DiscussionThread } from '@/components/forge/collab/DiscussionThread';
import type { DiscussionMsg, MemberRef } from '@/collab/types';
import { ProseBlock } from '@/components/patterns/prose-block';

/** Refine tabs — the task's plan text, then its discussion. */
const REFINE_TABS: readonly DocumentShellTab[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'discussion', label: 'Discussion' },
];

/** Validate tabs — the whole plan document, then the audit findings against it. */
const VALIDATE_TABS: readonly DocumentShellTab[] = [
  { id: 'document', label: 'Plan' },
  { id: 'audit', label: 'Audit' },
];
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
} from '@/components/ui';
import { useRouter } from 'next/navigation';
import { ConversationComposer } from '@/components/patterns/conversation';
import { stagePhaseStore, useStagePhaseUrl } from '@/components/forge/stage-substeps';
import type { ProjectPhase } from '@/db/enums';
import type { PlanPhaseSeed, PlanAuditFinding } from '@/build/plan-types';
import { FindingsGrid, FindingsApplyBar, AuditRoundCard as PatternAuditRoundCard, type Finding } from '@/components/patterns/findings';
import { RailNote } from '@/components/patterns/feature-rail';
import { ParticipantStrip } from '@/components/forge/collab/Participants';
import type { Participant } from '@/collab/types';

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

- **Plan/Audit** toggle to view the full plan or audit findings
- **Run audit** — MMA checks sequencing, coverage, and TDD gaps
- **Select findings** — pick which to apply, or apply all at once
- **Re-audit** — run again after fixes to verify

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
  phase?: ProjectPhase;
  mmaReady: boolean;
  currentMember?: { id: string; displayName: string; avatarTint: string };
  projectMembers?: { id: string; displayName: string; avatarTint: string }[];
  initialMessages?: Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId?: string | null }>>;
  phases: PlanPhaseSeed[];
  planMd: string;
  auditRounds: PlanAuditFinding[][];
  auditApplied?: boolean[];
  voiceEnabled?: boolean;
  pendingAuthor?: string | null;
  pendingAudit?: string | null;
  pendingApply?: string | null;
  initialPhase?: 'refine' | 'validate';
  readOnly?: boolean;
  /** Why the stage is read-only — shown by AutomationBar. */
  lockedReason?: string;
}

let _id = 0;
const nid = () => `pm${_id++}`;

/**
 * A task's discussion is "refining" when either the local set knows a refine is in flight
 * for it, OR a `plan-refine` batch is in flight per the server-reconstructed busy handlers.
 * The latter is what makes the "Forge is refining" indicator + composer-lock SURVIVE
 * navigation: the local set is lost on unmount, but `mma.busyHandlers` rehydrates from
 * `/pending-handlers` on remount. (busyHandlers carries the handler name, not the task id,
 * so on the rare case of viewing a DIFFERENT task while a refine runs, the indicator shows
 * on the viewed task — strictly better than silently dropping it.)
 */
export function isTaskRefining(
  taskId: string,
  refiningTasks: ReadonlySet<string>,
  busyHandlers: ReadonlySet<string>,
): boolean {
  return refiningTasks.has(taskId) || busyHandlers.has('plan-refine');
}

export function PlanStageClient(props: PlanStageClientProps) {
  const router = useRouter();
  const readOnly = props.readOnly ?? false;
  const lockedReason = props.lockedReason;
  const [phases] = useServerState(props.phases);
  const allTasks = useMemo(() => phases.flatMap((p) => p.tasks), [phases]);

  const allApprovedInit = allTasks.length > 0 && allTasks.every((t) => t.dbStatus === 'committed' || t.dbStatus === 'approved');
  const derivedPhase: PlanPhase = allApprovedInit ? 'validate' : 'refine';
  const safeInitial = props.initialPhase === 'validate' && !allApprovedInit ? undefined : props.initialPhase;
  const [phase, setPhaseRaw] = useState<PlanPhase>(safeInitial ?? derivedPhase);

  const setPhase = (p: PlanPhase) => {
    setPhaseRaw(p);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('phase', p);
      router.push(url.pathname + url.search, { scroll: false });
    }
  };
  const advancePhase = async (p: PlanPhase) => {
    // Plan phase status gates the resolver (validate.status==='active' runs the audit
    // loop), so refine→validate goes through the unified engine as advance_phase.
    await mma.transition('advance_phase').catch(() => {
      showToast({ type: 'error', message: 'Couldn’t advance the phase — try again.' });
    });
    setPhase(p);
  };
  const serverStatus = useMemo(
    () => Object.fromEntries(allTasks.map((t) => [t.id, (t.dbStatus === 'committed' || t.dbStatus === 'approved' ? 'approved' : 'proposed') as TaskStatus])),
    [allTasks],
  );
  const prevServerRef = useRef(serverStatus);
  const [localOverrides, setLocalOverrides] = useState<Record<string, TaskStatus>>({});
  // eslint-disable-next-line react-hooks/refs -- prop-sync: compare prev server value to reset local overrides during render (React docs pattern)
  if (prevServerRef.current !== serverStatus) {
    // eslint-disable-next-line react-hooks/refs -- prop-sync: store latest server value so the comparison above runs once per change (React docs pattern)
    prevServerRef.current = serverStatus;
    if (Object.keys(localOverrides).length > 0) setLocalOverrides({});
  }
  const status: Record<string, TaskStatus> = { ...serverStatus, ...localOverrides };
  const setStatus = (updater: (prev: Record<string, TaskStatus>) => Record<string, TaskStatus>) => {
    setLocalOverrides((prev) => {
      const merged = { ...serverStatus, ...prev };
      const next = updater(merged);
      const overrides: Record<string, TaskStatus> = {};
      for (const [k, v] of Object.entries(next)) {
        if (v !== serverStatus[k]) overrides[k] = v;
      }
      return overrides;
    });
  };
  const initialRounds = useMemo(
    () => props.auditRounds.map((findings, i) => {
      const hasCritHigh = findings.some((f) => f.severity === 'critical' || f.severity === 'high');
      return { passNo: i + 1, verdict: hasCritHigh ? 'revised' as const : 'clean' as const, findings };
    }),
    [props.auditRounds],
  );
  const [rounds] = useServerState(initialRounds);
  const optimistic = useOptimisticAction();
  const [locked, setLocked] = useState(false);
  const [applying, setApplying] = useState(!!props.pendingApply);
  const [applyingPass, setApplyingPass] = useState<number | null>(null);
  const [appliedPasses, setAppliedPasses] = useState<Set<number>>(
    () => new Set((props.auditApplied ?? []).flatMap((v, i) => v ? [i + 1] : [])),
  );


  const refresh = useCallback(() => { router.refresh(); }, [router]);
  // Sync MMA-dispatch effects (author/audit/apply) resolve their POST on completion,
  // so they drive local flags + an explicit refresh rather than SSE busy-handlers.
  // plan-refine (task chat, Task 10e) still uses the SSE handler path.
  const [authoringLocal, setAuthoringLocal] = useState(false);
  const [auditingLocal, setAuditingLocal] = useState(false);
  const mma = useMmaDispatch(props.projectId, {
    onDone: {
      'plan-refine': refresh,
    },
    events: {
      'plan.updated': (data) => {
        window.dispatchEvent(new CustomEvent('plan:updated', { detail: data }));
        refresh();
      },
      'chat.message': (data) => {
        window.dispatchEvent(new CustomEvent('chat:message', { detail: data }));
      },
    },
  });
  const authoring = !!props.pendingAuthor || authoringLocal;

  // Auto-trigger plan authoring if no plan exists yet. A synchronous ref guards
  // against the React strict-mode double-mount firing two author dispatches.
  const authorFiredRef = useRef(false);
  useEffect(() => {
    if (readOnly || allTasks.length > 0 || props.pendingAuthor || authorFiredRef.current) return;
    authorFiredRef.current = true;
    setAuthoringLocal(true);
    void mma.transition('dispatch_plan_author')
      .then(() => refresh())
      .catch(() => { showToast({ type: 'error', message: 'Couldn’t author the plan — try again.' }); })
      .finally(() => setAuthoringLocal(false));
  }, [readOnly, allTasks.length, props.pendingAuthor, props.projectId, mma, refresh]);

  useStagePhaseUrl(phase);
  // Sub-phase navigation from the top stepper. The stepper only renders a chip as
  // clickable once that phase is reachable (its `furthest`/lastPhase logic), so we
  // trust the click and just switch the view — the approval gate lives on the
  // "Continue to Validate" advance button, NOT on viewing. Re-gating here made the
  // Validate chip a dead button whenever `allApproved` was momentarily false (e.g.
  // revisiting a completed Plan stage where tasks didn't all resolve to approved).
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'refine' || key === 'validate') setPhase(key as PlanPhase);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: subscribe once on mount; setPhase is a stable setter
    [],
  );


  const approvedCount = allTasks.filter((t) => status[t.id] === 'approved').length;
  const allApproved = allTasks.length > 0 && approvedCount === allTasks.length;
  const auditClean = rounds[rounds.length - 1]?.verdict === 'clean';

  const auditing = !!props.pendingAudit || auditingLocal;
  const auditingRef = useRef(false);

  function runAudit() {
    if (auditingRef.current) return;
    auditingRef.current = true;
    setAuditingLocal(true);
    void mma.transition('dispatch_audit')
      .then(() => { refresh(); })
      .catch(() => { showToast({ type: 'error', message: 'Couldn’t run the audit — try again.' }); })
      .finally(() => { auditingRef.current = false; setAuditingLocal(false); });
  }

  const [applyCount, setApplyCount] = useState(0);
  const applyFindings = useCallback((indices: number[], passNo?: number) => {
    setApplying(true);
    setApplyCount(indices.length);
    if (passNo) setApplyingPass(passNo);
    // Same effect as auto mode — only the array size differs. Auto dispatches the whole
    // pass; manual sends the selected subset (or all) as `findingIndices`.
    void mma.transition('apply_findings', { findingIndices: indices, passNo })
      .then(() => {
        setApplying(false);
        if (passNo) setAppliedPasses((prev) => new Set(prev).add(passNo));
        setApplyingPass(null);
        refresh();
      })
      .catch(() => {
        setApplying(false);
        setApplyingPass(null);
        showToast({ type: 'error', message: 'Couldn’t apply findings — try again.' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectId is stable for the component's life; kept so the compiler can preserve this memoization
  }, [props.projectId, mma, refresh]);

  // ── Automated-mode driver. The on-screen plan IS the shared state, so Stop

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
        projectId={props.projectId}
        disabled={readOnly || locked}
        lockedReason={lockedReason}
      />

      {phase === 'refine' ? (
        <DetailStage
          projectId={props.projectId}
          phases={phases}
          status={status}
          readOnly={readOnly}
          authoring={authoring}
          voiceEnabled={props.voiceEnabled}
          approvedCount={approvedCount}
          allApproved={allApproved}
          mma={mma}
          currentMember={props.currentMember}
          projectMembers={props.projectMembers ?? []}
          initialMessages={props.initialMessages ?? {}}
          onToggleApprove={(id) => {
            // Task approval is monotonic in the unified model (the resolver never
            // un-approves), so this is a one-way approve_task transition.
            if (status[id] === 'approved') return;
            void optimistic.run({
              apply: () => setStatus((s) => ({ ...s, [id]: 'approved' as TaskStatus })),
              commit: () => mma.transition('approve_task', { taskId: id }),
              rollback: () => setLocalOverrides((o) => { const n = { ...o }; delete n[id]; return n; }),
              onSettled: () => { setLocalOverrides({}); router.refresh(); },
              error: 'Couldn’t approve task — reverted.',
              retryable: true,
            });
          }}
          onValidate={() => advancePhase('validate')}
        />
      ) : (
        <ValidateStage
          projectId={props.projectId}
          projectName={props.projectName}
          planMd={props.planMd}
          readOnly={readOnly}
          mmaReady={props.mmaReady}
          auditing={auditing}
          applying={applying}
          applyingPass={applyingPass}
          appliedPasses={appliedPasses}
          applyCount={applyCount}
          onApplyFindings={applyFindings}
          rounds={rounds}
          locked={locked}
          auditClean={auditClean}
          onRunAudit={runAudit}
          onLock={async () => {
            setLocked(true);
            try {
              await mma.transition('approve_stage'); // plan → execute (signs Forge + advances)
            } catch { setLocked(false); return; } // rejected → stay on Plan
            router.push(`/projects/${props.projectId}/execute`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ── Shared chat primitives (same language as the Spec stage) ───────────────── */

/* ── Detail -- per-task dialogue (like Craft) ────────────────────────────────── */
function DetailStage({
  projectId,
  phases,
  status,
  readOnly,
  authoring,
  voiceEnabled,
  approvedCount,
  allApproved,
  mma,
  currentMember,
  projectMembers,
  initialMessages,
  onToggleApprove,
  onValidate,
}: {
  projectId: string;
  phases: PlanPhaseSeed[];
  status: Record<string, TaskStatus>;
  readOnly: boolean;
  authoring?: boolean;
  voiceEnabled?: boolean;
  approvedCount: number;
  allApproved: boolean;
  mma: ReturnType<typeof useMmaDispatch>;
  currentMember?: { id: string; displayName: string; avatarTint: string };
  projectMembers: { id: string; displayName: string; avatarTint: string }[];
  initialMessages: Record<string, Array<{ id: string; sender: 'forge' | 'member'; bodyMd: string; authorId?: string | null }>>;
  onToggleApprove: (id: string) => void;
  onValidate: () => void;
}) {
  const allTasks = phases.flatMap((p) => p.tasks);
  const firstOpen = allTasks.find((t) => status[t.id] !== 'approved') ?? allTasks[0];
  const [activeId, setActiveId] = useState<string>(firstOpen?.id ?? '');
  const [threads, setThreads] = useState<Record<string, Msg[]>>(() => {
    const out: Record<string, Msg[]> = {};
    for (const [taskId, msgs] of Object.entries(initialMessages)) {
      out[taskId] = msgs.map((m) => ({ id: m.id, role: m.sender === 'forge' ? 'forge' as const : 'user' as const, text: m.bodyMd }));
    }
    return out;
  });
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = allTasks.find((t) => t.id === activeId) ?? allTasks[0];

  const contentRef = useRef<HTMLDivElement>(null);

  // Follow the AI as it auto-approves.
  useEffect(() => {
    if (active && status[active.id] === 'approved') {
      const next = allTasks.find((t) => status[t.id] !== 'approved');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the AI's auto-approval by advancing the active task from status changes
      if (next) setActiveId(next.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const [refiningTasks, setRefiningTasks] = useState<Set<string>>(new Set());
  const [taskViewOverride, setTaskViewOverride] = useState<Record<string, 'plan' | 'discussion'>>({});
  const activeThread = threads[active?.id ?? ''] ?? [];
  const lastMsg = activeThread[activeThread.length - 1];
  const hasQuestions = lastMsg?.role === 'forge';
  const taskView = active ? (taskViewOverride[active.id] ?? (hasQuestions ? 'discussion' : 'plan')) : 'plan';
  const setTaskView = (v: 'plan' | 'discussion') => {
    if (active) setTaskViewOverride((prev) => ({ ...prev, [active.id]: v }));
  };

  useEffect(() => {
    if (taskView === 'discussion') {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    } else {
      contentRef.current?.scrollTo?.(0, 0);
    }
  }, [activeId, taskView, threads]);
  // Plan-level participants — invite once, can approve any task
  const [planParticipants, setPlanParticipants] = useState<Participant[]>(() => {
    const seen = new Set<string>();
    const result: Participant[] = [];
    const memberById = new Map(projectMembers.map((m) => [m.id, m]));
    for (const t of allTasks) {
      for (const pid of (t.participantIds ?? [])) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const m = memberById.get(pid);
        if (m) result.push({ member: m, addedBy: null, approvedAt: null });
      }
    }
    return result;
  });
  const optimistic = useOptimisticAction();
  const meParticipant: Participant | null = currentMember
    ? { member: currentMember, addedBy: null, approvedAt: null }
    : null;
  const allParticipants: Participant[] = meParticipant
    ? [meParticipant, ...planParticipants.filter((p) => p.member.id !== meParticipant.member.id)]
    : planParticipants;

  useEffect(() => {
    function onPlanUpdated(e: Event) {
      const detail = (e as CustomEvent).detail as { taskId?: string; chatReply?: string } | undefined;
      if (!detail?.taskId || !detail?.chatReply) return;
      setRefiningTasks((prev) => { const next = new Set(prev); next.delete(detail.taskId!); return next; });
      setThreads((th) => ({
        ...th,
        [detail.taskId!]: [...(th[detail.taskId!] ?? []), { id: nid(), role: 'forge', text: detail.chatReply! }],
      }));
    }
    window.addEventListener('plan:updated', onPlanUpdated);
    return () => window.removeEventListener('plan:updated', onPlanUpdated);
  }, []);

  // These hooks MUST run unconditionally, before the early returns below, or
  // hook order changes between renders (rules of hooks). None of them depend on
  // `active` or anything computed after the returns.
  const forgeMentionPool = useMemo(() => {
    const forge = { id: 'forge', displayName: 'Forge', avatarTint: '#8B6914' };
    return [forge, ...projectMembers];
  }, [projectMembers]);

  const seenMsgIds = useRef(new Set(
    Object.values(initialMessages).flatMap((msgs) => msgs.map((m) => m.id)),
  ));

  useEffect(() => {
    function onChatMessage(e: Event) {
      const detail = (e as CustomEvent).detail as {
        scope?: 'spec_component' | 'spec_project' | 'plan_task';
        targetId?: string;
        message?: { id: string; sender: string; authorId: string; bodyMd: string };
      } | undefined;
      if (detail?.scope !== 'plan_task' || !detail.targetId || !detail.message) return;
      if (detail.message.authorId === currentMember?.id) return;
      if (seenMsgIds.current.has(detail.message.id)) return;
      seenMsgIds.current.add(detail.message.id);
      setThreads((th) => ({
        ...th,
        [detail.targetId!]: [
          ...(th[detail.targetId!] ?? []),
          { id: detail.message!.id, role: detail.message!.sender === 'forge' ? 'forge' as const : 'user' as const, text: detail.message!.bodyMd },
        ],
      }));
    }
    window.addEventListener('chat:message', onChatMessage);
    return () => window.removeEventListener('chat:message', onChatMessage);
  }, [currentMember?.id]);

  if (authoring && allTasks.length === 0) {
    return (
      <StageShell
        note={<>
          <RailNote icon={<ListTree />}>{PLAN_PHASE_NOTES.refine}</RailNote>
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
            <div className="flex items-center gap-2 border-b border-line px-5 py-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2" />
              <span className="shrink-0 text-xs font-medium text-ink-faint">0/0</span>
            </div>
            <CardContent className="flex min-h-0 flex-1 items-center justify-center">
              <p className="text-xs text-ink-faint">Tasks appear here once the plan is drafted.</p>
            </CardContent>
          </Card>
          </>}
      >
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Plan tasks</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="size-6 animate-spin text-accent" />
              <p className="text-sm font-medium text-ink">Authoring plan from locked spec...</p>
              <p className="text-xs text-ink-soft">Forge writes the implementation plan from the locked spec. This takes a moment.</p>
            </div>
          </CardContent>
        </Card>
      </StageShell>
    );
  }

  if (!active) {
    return (
      <StageShell
        note={<RailNote icon={<ListTree />}>{PLAN_PHASE_NOTES.refine}</RailNote>}
      >
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader><CardTitle>Plan tasks</CardTitle></CardHeader>
          <CardContent className="flex min-h-0 flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <ListTree className="size-8 text-ink-faint" />
              <p className="text-sm font-medium text-ink">No plan yet</p>
              <p className="text-xs text-ink-soft">The plan is authored from the locked spec. Make sure a repo is linked to the project.</p>
              <Button
                size="sm"
                onClick={() => {
                  void mma.transition('dispatch_plan_author').catch(() => {
                    showToast({ type: 'error', message: 'Couldn’t author the plan — try again.' });
                  });
                }}
                disabled={readOnly}
                leftIcon={<Sparkles />}
              >
                Author plan
              </Button>
            </div>
          </CardContent>
        </Card>
      </StageShell>
    );
  }
  const approved = status[active?.id ?? ''] === 'approved';
  const msgs = threads[active?.id ?? ''] ?? [];

  // The task thread in the shared DiscussionMsg shape. `role` is a transport detail of the
  // refine endpoint; attribution is a member id, so Forge renders as Forge and a teammate
  // renders with their real name and avatar (the old ChatUser hardcoded "AD" for everyone).
  const discussion: DiscussionMsg[] = msgs.map((m) => ({
    id: m.id,
    authorId: m.role === 'user' ? (currentMember?.id ?? 'me') : 'forge',
    body: (m as { text: string }).text,
  }));

  /** Resolve a member id for attribution (you · project pool). */
  function memberById(id: string): MemberRef | undefined {
    if (currentMember && id === currentMember.id) return currentMember;
    return projectMembers.find((m) => m.id === id);
  }

  function send() {
    const text = input.trim();
    if (!text || (active && isTaskRefining(active.id, refiningTasks, mma.busyHandlers))) return;
    setInput('');

    const tempId = `tmp-${Date.now()}`;
    setThreads((th) => ({
      ...th,
      [active.id]: [...(th[active.id] ?? []), { id: tempId, role: 'user', text }],
    }));

    fetch(`/api/projects/${projectId}/plan/tasks/${active.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyMd: text }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { id: string } | null) => {
        if (data) {
          seenMsgIds.current.add(data.id);
          setThreads((th) => ({
            ...th,
            [active.id]: (th[active.id] ?? []).map((m) => m.id === tempId ? { ...m, id: data.id } : m),
          }));
        }
      })
      .catch(() => {});

    const forgeTagged = /@forge\b/i.test(text);
    if (forgeTagged) {
      const cleanText = text.replace(/@forge\s*/gi, '').trim() || 'Refine this task based on the discussion.';
      const refineTaskId = active.id;
      setRefiningTasks((prev) => new Set(prev).add(refineTaskId));
      setTaskView('discussion');
      // Sanctioned non-transition content op (see CLAUDE.md route exceptions): a
      // user-message-driven per-task refine, distinct from the auto-driver's
      // `validate_task`. `mma.dispatch(url, handler)` is on the centralized client path;
      // the backend uses dispatchMma + the registered `plan-refine` handler.
      void mma.dispatch(
        `/projects/${projectId}/plan/tasks/${refineTaskId}/refine`,
        'plan-refine',
        { message: cleanText },
      ).catch(() => {
        setRefiningTasks((prev) => { const next = new Set(prev); next.delete(refineTaskId); return next; });
        setThreads((th) => ({
          ...th,
          [active.id]: [...(th[active.id] ?? []), { id: nid(), role: 'forge', text: 'The refinement failed — try again or approve as-is.' }],
        }));
      });
    }
  }

  return (
    <StageShell
      note={<RailNote icon={<ListTree />}>{PLAN_PHASE_NOTES.refine}</RailNote>}
      navigator={
        <StageNavigator
          className="flex-1"
          title="Tasks"
          action={
            <Button
              size="sm"
              onClick={() => {
                const targets = allApproved
                  ? allTasks.filter((t) => status[t.id] === 'approved')
                  : allTasks.filter((t) => status[t.id] !== 'approved');
                for (const t of targets) onToggleApprove(t.id);
              }}
              disabled={readOnly || allTasks.length === 0}
              leftIcon={allApproved ? <RotateCcw /> : <Check />}
            >
              {allApproved ? 'Revoke all' : 'Approve all'}
            </Button>
          }
          progress={{ value: approvedCount, total: allTasks.length }}
          showChecks
          groups={phases.map((p) => ({
            id: p.id,
            // A single phase needs no section header — the cluster is the whole list.
            label: phases.length > 1 ? p.title : undefined,
            items: p.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              meta: (
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-0.5">
                    <GitBranch className="size-2.5" /> {t.targetRepo}
                  </span>
                  {t.files.length > 0 ? <span>{t.files.length} files</span> : null}
                  {t.dependsOn.length > 0 ? <span>· deps {t.dependsOn.length}</span> : null}
                </span>
              ),
              index: t.num || 0,
              done: status[t.id] === 'approved',
              active: t.id === active?.id,
              onClick: () => setActiveId(t.id),
            })),
          }))}
          footer={
            <Button className="w-full" onClick={onValidate} disabled={!allApproved || readOnly} rightIcon={<ArrowRight />}>
              Continue to Validate
            </Button>
          }
        />
      }
    >
      {/* LEFT PANEL — the task document (plan ⋅ discussion). */}
      <DocumentShell
        className="flex min-h-0 flex-1 flex-col"
        meta={<Badge variant="neutral" size="sm">Task {active?.num || 0}</Badge>}
        title={active?.title ?? ''}
        tabs={REFINE_TABS}
        activeTab={taskView}
        onTabChange={(v) => setTaskView(v as 'plan' | 'discussion')}
        approvers={
          <div className="shrink-0 border-b border-line px-5 py-2.5">
            <ParticipantStrip
              participants={allParticipants}
              pool={projectMembers.map((m) => ({ ...m, avatarTint: m.avatarTint }))}
              onAdd={(m) => {
                if (planParticipants.some((p) => p.member.id === m.id)) return;
                void optimistic.run({
                  apply: () => setPlanParticipants((prev) => [...prev, { member: m, addedBy: null, approvedAt: null }]),
                  commit: async () => {
                    const results = await Promise.all(
                      allTasks.map((t) =>
                        fetch(`/api/projects/${projectId}/plan/tasks/${t.id}/invite`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ memberId: m.id }),
                        }),
                      ),
                    );
                    if (results.some((r) => !r.ok)) throw new Error('Invite failed.');
                  },
                  rollback: () => setPlanParticipants((prev) => prev.filter((p) => p.member.id !== m.id)),
                  error: 'Couldn’t invite — reverted.',
                  retryable: true,
                });
              }}
              disabled={readOnly}
            />
          </div>
        }
        bodyRef={contentRef}
        body={
          <>
            {taskView === 'plan' ? (
              <ProseBlock>
                {active.body}
              </ProseBlock>
            ) : (
              <div className="space-y-5">
                {msgs.length === 0 && !(active && isTaskRefining(active.id, refiningTasks, mma.busyHandlers)) ? (
                  <p className="py-8 text-center text-xs text-ink-faint">No discussion yet — send a message to refine this task.</p>
                ) : null}
                <DiscussionThread
                  messages={discussion}
                  memberById={memberById}
                  currentMemberId={currentMember?.id ?? 'me'}
                  mentionPool={projectMembers}
                  pending={!!active && isTaskRefining(active.id, refiningTasks, mma.busyHandlers)}
                />
                <div ref={bottomRef} />
              </div>
            )}
          </>
        }
        actions={
          taskView === 'plan' ? (
              <Button
                size="sm"
                onClick={() => onToggleApprove(active.id)}
                disabled={readOnly}
                variant={approved ? 'secondary' : 'primary'}
                leftIcon={approved ? <RotateCcw /> : <Check />}
              >
                {approved ? 'Revoke' : 'Approve'}
              </Button>
          ) : null
        }
        footer={
          taskView === 'discussion' ? (
            <ConversationComposer
              value={input}
              onChange={setInput}
              onSend={send}
              placeholder="@Forge to refine this task..."
              disabled={readOnly || (active != null && isTaskRefining(active.id, refiningTasks, mma.busyHandlers))}
              voice={voiceEnabled ?? false}
              mentionPool={forgeMentionPool}
            />
          ) : null
        }
      />
    </StageShell>
  );
}

/* ── Validate -- the Spec audit chat, applied to the plan ────────────────────── */
function ValidateStage({
  projectName,
  planMd,
  readOnly,
  mmaReady,
  auditing,
  applying,
  applyingPass,
  appliedPasses,
  applyCount,
  onApplyFindings,
  rounds,
  locked,
  onRunAudit,
  onLock,
}: {
  projectId: string;
  projectName: string;
  planMd: string;
  readOnly: boolean;
  mmaReady: boolean;
  auditing?: boolean;
  applying: boolean;
  applyingPass: number | null;
  appliedPasses: Set<number>;
  applyCount: number;
  onApplyFindings: (indices: number[], passNo?: number) => void;
  rounds: { passNo: number; verdict: 'clean' | 'revised'; findings: PlanAuditFinding[] }[];
  locked: boolean;
  auditClean: boolean;
  onRunAudit: () => void;
  onLock: () => void;
}) {
  const [docView, setDocView] = useState<'document' | 'audit'>(planMd ? 'document' : 'audit');
  const [selectedPass, setSelectedPass] = useState<number | null>(rounds.length > 0 ? rounds[rounds.length - 1].passNo : null);
  const activeRound = selectedPass !== null ? rounds.find((r) => r.passNo === selectedPass) : null;
  // Manual subset selection — indices into the active round's findings array.
  const [selectedFindings, setSelectedFindings] = useState<number[]>([]);
  const toggleFinding = (i: number) => setSelectedFindings((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the manual finding selection when the viewed pass changes
  useEffect(() => { setSelectedFindings([]); }, [selectedPass]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- jump to the newest audit pass when rounds grow
    if (rounds.length > 0) { setSelectedPass(rounds[rounds.length - 1].passNo); setDocView('audit'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: keys off rounds.length; reading full rounds only to index the latest, not to retrigger
  }, [rounds.length]);

  function apply(passNo: number, indices: number[]) {
    if (readOnly || applying || indices.length === 0) return;
    const round = rounds.find((r) => r.passNo === passNo);
    if (!round || round.findings.length === 0) return;
    onApplyFindings(indices, passNo);
  }

  return (
    <StageShell
      note={<RailNote icon={<ListTree />}>{PLAN_PHASE_NOTES.validate}</RailNote>}
      navigator={
        // Audit rounds, not a NavItem list — this rail renders AuditRoundCards, so it keeps
        // its own box. StageShell still owns the split, so the layout is not re-implemented.
        <>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Audit rounds</CardTitle>
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
            {!auditing && rounds.length === 0 ? (
              <div className="flex items-start gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3">
                <Shield className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <p className="text-xs leading-relaxed text-ink-soft">
                  Run an audit to check sequencing, coverage and TDD gaps.
                </p>
              </div>
            ) : null}
            {auditing ? (
              <div className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface-2/60 px-3 py-2.5">
                <Loader2 className="size-4 animate-spin text-accent" />
                <span className="text-sm font-medium text-ink">Pass {rounds.length + 1}</span>
                <span className="text-xs text-ink-faint">Running…</span>
              </div>
            ) : null}
            {[...rounds].reverse().map((r) => (
              <div key={r.passNo} className="relative">
                <PatternAuditRoundCard
                  passNo={r.passNo}
                  verdict={r.verdict}
                  findings={r.findings as Finding[]}
                  applied={appliedPasses.has(r.passNo)}
                  active={selectedPass === r.passNo && docView === 'audit'}
                  onClick={() => { setSelectedPass(r.passNo); setDocView('audit'); }}
                />
                {applying && applyingPass === r.passNo ? (
                  <div className="mt-1.5 flex items-center gap-2 rounded-[var(--r-md)] border border-accent/30 bg-accent-tint/30 px-3 py-1.5">
                    <Loader2 className="size-3.5 animate-spin text-accent" />
                    <span className="text-xs font-medium text-accent-deep">
                      Applying {applyCount} finding{applyCount !== 1 ? 's' : ''}...
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <StageAdvance
              onClick={onLock}
              label="Continue to Execute"
              disabled={readOnly || locked}
              gate
              testId="plan-lock-button"
            />
          </CardFooter>
        </Card>
        </>
      }
    >
      <DocumentShell
        className="flex min-h-0 flex-1 flex-col"
        title={`${projectName} — plan`}
        meta={locked ? <Badge variant="sage" size="sm"><Lock className="mr-1 size-3" /> locked</Badge> : null}
        tabs={VALIDATE_TABS}
        activeTab={docView}
        onTabChange={(v) => setDocView(v as 'document' | 'audit')}
        // Only the findings grid is edge-to-edge; the empty state keeps the inset.
        flush={docView === 'audit' && Boolean(activeRound)}
        body={
          <>
            {docView === 'document' && planMd ? (
              <ProseBlock>{planMd}</ProseBlock>
            ) : !activeRound ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--frost)]">
                  <Shield className="size-7 text-[var(--steel)]" />
                </span>
                <p className="mt-5 text-sm font-semibold text-ink">Ready for audit</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                  Run an audit from the right panel to check sequencing, coverage, and TDD gaps.
                </p>
              </div>
            ) : (
              <FindingsGrid
                findings={activeRound.findings as Finding[]}
                selectable
                selectedIndices={selectedFindings}
                onToggle={toggleFinding}
                applying={applying}
                applied={activeRound ? appliedPasses.has(activeRound.passNo) : false}
                readOnly={readOnly}
              />
            )}
          </>
        }
        footer={
          <>
            {docView === 'document' ? null
              : activeRound && activeRound.findings.length > 0 ? (
              // The apply bar stays put after applying — it locks (readOnly) rather than
              // vanishing, matching the governed AuditView so the three stages can't drift.
              <FindingsApplyBar
                selectedCount={selectedFindings.length}
                total={activeRound.findings.length}
                applying={applying}
                readOnly={readOnly || appliedPasses.has(activeRound.passNo)}
                onToggleAll={() => setSelectedFindings(selectedFindings.length === activeRound.findings.length ? [] : activeRound.findings.map((_, i) => i))}
                onApply={() => apply(activeRound.passNo, selectedFindings)}
              />
            ) : null}
            {!mmaReady ? (
              <div className="shrink-0 border-t border-line px-5 py-2">
                <TextSm className="!text-[var(--amber)]">
                  <a href="/settings/connections" className="underline">Configure the MMA token</a> to run the audit.
                </TextSm>
              </div>
            ) : null}
          </>
        }
      />
    </StageShell>
  );
}

