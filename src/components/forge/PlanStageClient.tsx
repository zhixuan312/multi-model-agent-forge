'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Markdown } from '@/components/forge/Markdown';
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
  Textarea,
  TextSm,
  Micro,
  Eyebrow,
} from '@/components/ui';
import { useRouter } from 'next/navigation';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import type { ProjectPhase } from '@/db/enums';
import type { PlanPhaseSeed, PlanTaskSeed, PlanAuditFinding } from '@/mock/domains/projects/plan-types';

type PlanPhase = 'decompose' | 'detail' | 'validate';
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
}

const SEVERITY_ORDER: PlanAuditFinding['severity'][] = ['critical', 'high', 'medium', 'low'];
const SEVERITY_STYLE: Record<PlanAuditFinding['severity'], string> = {
  critical: 'bg-rose-tint text-[var(--rose)]',
  high: 'bg-amber-tint text-[var(--amber)]',
  medium: 'bg-[var(--frost)] text-[var(--steel)]',
  low: 'bg-surface-2 text-ink-soft',
};

let _id = 0;
const nid = () => `pm${_id++}`;

/** The task's number (id `t8` → 8) — matches the "Task N" used in dependsOn. */
const taskNum = (id: string) => Number(id.replace(/\D/g, '')) || 0;

export function PlanStageClient(props: PlanStageClientProps) {
  const router = useRouter();
  const readOnly = props.phase !== 'design';
  const allTasks = useMemo(() => props.phases.flatMap((p) => p.tasks), [props.phases]);

  const [phase, setPhase] = useState<PlanPhase>('decompose');
  const [status, setStatus] = useState<Record<string, TaskStatus>>(
    () => Object.fromEntries(allTasks.map((t) => [t.id, 'proposed' as TaskStatus])),
  );
  const [rounds, setRounds] = useState<{ passNo: number; verdict: 'clean' | 'revised'; findings: PlanAuditFinding[] }[]>([]);
  const [locked, setLocked] = useState(false);

  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');

  useEffect(() => stagePhaseStore.set(phase), [phase]);
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'decompose' || key === 'detail' || key === 'validate') setPhase(key as PlanPhase);
      }),
    [],
  );

  // Arriving in automated mode (?auto=1, e.g. from Spec Document) → keep driving.
  useEffect(() => {
    if (readOnly) return;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      setAutoNote('AI is driving — decomposing the spec…');
      setAuto('running');
    }
  }, [readOnly]);

  const approvedCount = allTasks.filter((t) => status[t.id] === 'approved').length;
  const allApproved = allTasks.length > 0 && approvedCount === allTasks.length;
  const auditClean = rounds[rounds.length - 1]?.verdict === 'clean';

  function runAudit() {
    const passNo = rounds.length + 1;
    const findings = props.auditRounds[passNo - 1] ?? [];
    const hasCritHigh = findings.some((f) => f.severity === 'critical' || f.severity === 'high');
    setRounds((r) => [...r, { passNo, verdict: hasCritHigh ? 'revised' : 'clean', findings }]);
  }

  // ── Automated-mode driver. The on-screen plan IS the shared state, so Stop
  // hands the wheel back mid-flight and Run resumes from exactly here.
  useEffect(() => {
    // NB: don't bail on `locked` — once locked, the final step is to navigate
    // into Execute, which still needs to run.
    if (auto !== 'running' || readOnly) return;
    const t = setTimeout(() => {
      if (phase === 'decompose') {
        setAutoNote('Self-evaluated the skeleton — ' + props.phases.length + ' phases look sound. Detailing tasks…');
        setPhase('detail');
      } else if (phase === 'detail') {
        const next = allTasks.find((tk) => status[tk.id] !== 'approved');
        if (next) {
          setAutoNote('Drafted & approved: ' + next.title);
          setStatus((s) => ({ ...s, [next.id]: 'approved' }));
        } else {
          setAutoNote('All tasks drafted — validating the plan…');
          setPhase('validate');
        }
      } else if (phase === 'validate') {
        if (!auditClean && rounds.length < props.auditRounds.length) {
          setAutoNote('Ran audit pass ' + (rounds.length + 1) + ' — applied critical/high fixes.');
          runAudit();
        } else if (!locked) {
          setAutoNote('Critical & high cleared — locking the plan, on to Build.');
          setLocked(true);
        } else {
          // Plan is locked — carry the automated run into the Execute stage.
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
          setAutoNote('AI is driving — reviewing the decomposition…');
          setAuto('running');
        }}
        onStop={() => {
          setAuto('off');
          setAutoNote('Stopped — you have the wheel.');
        }}
      />

      {phase === 'decompose' ? (
        <DecomposeStage
          phases={props.phases}
          intentMd={props.intentMd}
          readOnly={readOnly}
          driving={auto === 'running'}
          onApprove={() => setPhase('detail')}
        />
      ) : phase === 'detail' ? (
        <DetailStage
          phases={props.phases}
          status={status}
          readOnly={readOnly}
          driving={auto === 'running'}
          approvedCount={approvedCount}
          allApproved={allApproved}
          onToggleApprove={(id) => setStatus((s) => ({ ...s, [id]: s[id] === 'approved' ? 'detailed' : 'approved' }))}
          onValidate={() => setPhase('validate')}
        />
      ) : (
        <ValidateStage
          projectName={props.projectName}
          planMd={props.planMd}
          readOnly={readOnly}
          mmaReady={props.mmaReady}
          driving={auto === 'running'}
          rounds={rounds}
          locked={locked}
          auditClean={auditClean}
          onRunAudit={runAudit}
          onLock={() => {
            setLocked(true);
            router.push(`/projects/${props.projectId}/execute`);
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
            <Markdown className="max-w-none prose-headings:mb-1.5 prose-headings:mt-4 first:prose-headings:mt-0">{md}</Markdown>
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

function Composer({
  value,
  onChange,
  onSend,
  secondaries,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  secondaries?: ComposerAction[];
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <div className="shrink-0 border-t border-line px-5 py-4">
      <div className="flex gap-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sage-tint text-[11px] font-semibold text-[var(--sage-deep)]">
          AD
        </span>
        <div className="min-w-0 flex-1">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            disabled={disabled}
            placeholder={placeholder}
            className="!min-h-0 !rounded-2xl !text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(secondaries ?? []).map((s, i) => (
              <Button key={i} size="sm" variant="ghost" onClick={s.onClick} disabled={disabled || s.disabled} leftIcon={s.icon}>
                {s.label}
              </Button>
            ))}
            <span className="flex-1" />
            <Button size="sm" onClick={onSend} disabled={disabled || !value.trim()} rightIcon={<ArrowRight />}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Decompose — dialogue that scaffolds the plan skeleton ──────────────────── */
function DecomposeStage({
  phases,
  intentMd,
  readOnly,
  driving,
  onApprove,
}: {
  phases: PlanPhaseSeed[];
  intentMd: string;
  readOnly: boolean;
  driving: boolean;
  onApprove: () => void;
}) {
  const taskCount = phases.reduce((n, p) => n + p.tasks.length, 0);
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    {
      id: nid(),
      role: 'forge',
      text: `I decomposed the spec into ${phases.length} phases and ${taskCount} bite-sized, test-first tasks (shown on the right). Tell me to split, merge, reorder, or add a phase — or approve the skeleton and we'll detail each task.`,
    },
  ]);
  const [input, setInput] = useState('');
  // The skeleton only refreshes when you re-draft — chatting alone leaves it as-is.
  const [redrafting, setRedrafting] = useState(false);
  const redraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (redraftTimer.current) clearTimeout(redraftTimer.current); }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'end' }), [msgs]);

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMsgs((m) => [
      ...m,
      { id: nid(), role: 'user', text },
      { id: nid(), role: 'forge', text: 'Noted — I’ll fold that in. Hit “Re-draft skeleton” to refresh the plan on the right, or approve it as-is.' },
    ]);
  }
  function redraft() {
    if (redrafting) return;
    setMsgs((m) => [...m, { id: nid(), role: 'forge', text: 'Re-drafting the skeleton from our discussion…' }]);
    setRedrafting(true);
    redraftTimer.current = setTimeout(() => {
      setRedrafting(false);
      setMsgs((m) => [...m, { id: nid(), role: 'forge', text: `Refreshed — ${phases.length} phases, ${taskCount} tasks, resequenced for dependencies.` }]);
    }, 900);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE — the decomposition conversation (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <ListTree className="size-4 shrink-0 text-accent" />
            <CardTitle>Decompose the plan</CardTitle>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
            <Sparkles className="size-3" /> from the spec
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-surface-2/40 !py-5">
          {msgs.map((m) => (m.role === 'user' ? <ChatUser key={m.id} text={m.text} /> : <ChatForge key={m.id}>{(m as { text: string }).text}</ChatForge>))}
          <div ref={bottomRef} />
        </CardContent>
        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          secondaries={[{ label: 'Re-draft skeleton', icon: <Sparkles />, onClick: redraft, disabled: readOnly }]}
          placeholder="Discuss the decomposition — “split task 3”, “add a migration phase”…"
          disabled={readOnly || driving}
        />
      </Card>

      {/* RIGHT — the live skeleton + approve (1/3) */}
      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Plan skeleton</CardTitle>
            <span className="text-sm font-medium text-ink-faint">
              {phases.length}p · {taskCount}t
            </span>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            {redrafting ? (
              <div className="grid h-full place-items-center">
                <div className="flex flex-col items-center gap-2 text-ink-faint">
                  <Loader2 className="size-5 animate-spin text-accent" />
                  <span className="text-xs">Re-drafting the skeleton…</span>
                </div>
              </div>
            ) : (
              <>
            <div className="flex items-start gap-2 rounded-[var(--r-md)] border border-accent-tint bg-accent-tint/30 px-3 py-2.5">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
              <p className="text-[11px] leading-relaxed text-ink-soft">{intentMd}</p>
            </div>
            {phases.map((p, i) => (
              <div key={p.id} className="rounded-[var(--r-md)] border border-line bg-surface">
                <p className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[13px] font-semibold text-ink">
                  <span className="grid size-4 place-items-center rounded-full bg-accent-tint text-[10px] font-semibold text-accent">{i + 1}</span>
                  {p.title}
                </p>
                <ul className="divide-y divide-line/70">
                  {p.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </ul>
              </div>
            ))}
              </>
            )}
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={onApprove} disabled={readOnly} rightIcon={<ArrowRight />}>
              Approve &amp; detail tasks
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

function TaskRow({ task }: { task: PlanTaskSeed }) {
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-surface-2 font-mono text-[10px] font-semibold text-ink-soft">
          {taskNum(task.id)}
        </span>
        <span className="text-[13px] font-medium text-ink">{task.title}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-[26px] text-[10px] text-ink-faint">
        <span className="inline-flex items-center gap-1">
          <GitBranch className="size-2.5" /> {task.targetRepo}
        </span>
        {task.dependsOn.length > 0 ? <span>· deps {task.dependsOn.join(', ')}</span> : null}
      </div>
    </li>
  );
}

/* ── Detail — per-task dialogue (like Craft) ────────────────────────────────── */
function DetailStage({
  phases,
  status,
  readOnly,
  driving,
  approvedCount,
  allApproved,
  onToggleApprove,
  onValidate,
}: {
  phases: PlanPhaseSeed[];
  status: Record<string, TaskStatus>;
  readOnly: boolean;
  driving: boolean;
  approvedCount: number;
  allApproved: boolean;
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

  // Seed the active task's conversation with Forge's opener.
  useEffect(() => {
    if (!active || threads[active.id]) return;
    const dep = active.dependsOn.length ? ` It depends on ${active.dependsOn.join(', ')}.` : ' It has no dependencies.';
    setThreads((th) => ({
      ...th,
      [active.id]: [
        {
          id: nid(),
          role: 'forge',
          text: `Here’s Task ${active.num} — “${active.title}” — in full below: the failing test, the implementation, the run commands, and the commit.${dep} Want a different approach, a different sequencing, or extra edge-case tests?`,
        },
      ],
    }));
  }, [active, threads]);
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'end' }), [threads, activeId]);

  // Follow the AI as it auto-approves.
  useEffect(() => {
    if (active && status[active.id] === 'approved') {
      const next = allTasks.find((t) => status[t.id] !== 'approved');
      if (next) setActiveId(next.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (!active) return null;
  const approved = status[active.id] === 'approved';
  const msgs = threads[active.id] ?? [];

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setThreads((th) => ({
      ...th,
      [active.id]: [
        ...(th[active.id] ?? []),
        { id: nid(), role: 'user', text },
        { id: nid(), role: 'forge', text: 'Good call — I’ll fold that into the task below. Approve when it reads right.' },
      ],
    }));
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE — the per-task conversation + TDD draft (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="neutral" size="sm">
              Task {taskNum(active.id)}
            </Badge>
            <CardTitle>{active.title}</CardTitle>
          </div>
          {phaseOf ? <Micro className="!text-ink-faint">{phaseOf.title}</Micro> : null}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-surface-2/40 !py-5">
          {msgs.map((m) => (m.role === 'user' ? <ChatUser key={m.id} text={m.text} /> : <ChatForge key={m.id}>{(m as { text: string }).text}</ChatForge>))}
          {/* The FULL task — exactly as the plan writes it (Files, TDD steps, code, commit). */}
          <div className="rounded-[var(--r-md)] border border-line bg-surface px-4 py-3.5">
            <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2">
              <Micro className="!font-semibold !uppercase !tracking-wide !text-ink-faint">Task {taskNum(active.id)} · full plan</Micro>
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
                <GitBranch className="size-2.5" /> {active.targetRepo}
              </span>
            </div>
            <Markdown className="max-w-none prose-headings:mb-1.5 prose-headings:mt-4 first:prose-headings:mt-0">
              {active.body}
            </Markdown>
          </div>
          <div ref={bottomRef} />
        </CardContent>
        {approved ? (
          <CardFooter>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="size-5 shrink-0 text-[var(--sage)]" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Task approved</p>
                <p className="text-xs text-ink-faint">Re-open to revoke and keep discussing, or pick another task.</p>
              </div>
            </div>
            <Button variant="secondary" onClick={() => onToggleApprove(active.id)} disabled={readOnly} leftIcon={<RotateCcw />}>
              Re-open to edit
            </Button>
          </CardFooter>
        ) : (
          <Composer
            value={input}
            onChange={setInput}
            onSend={send}
            secondaries={[{ label: 'Approve task', icon: <Check />, onClick: () => onToggleApprove(active.id), disabled: readOnly }]}
            placeholder="Discuss the approach — “use a fixture diff”, “tighten the review”…"
            disabled={readOnly || driving}
          />
        )}
      </Card>

      {/* RIGHT — every task grouped by phase + move-on (1/3) */}
      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <span className="text-sm font-medium text-ink-faint">
              {approvedCount}/{allTasks.length}
            </span>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-[var(--sage)] transition-all" style={{ width: `${allTasks.length ? (approvedCount / allTasks.length) * 100 : 0}%` }} />
            </div>
            {phases.map((p) => (
              <div key={p.id} className="space-y-1.5">
                <Micro className="block !font-semibold !uppercase !tracking-wide !text-ink-faint">{p.title}</Micro>
                {p.tasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveId(t.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[var(--r-md)] border px-3 py-2 text-left transition-colors',
                      t.id === active.id ? 'border-accent bg-surface shadow-sm' : 'border-transparent hover:bg-surface-2/50',
                    )}
                  >
                    {status[t.id] === 'approved' ? (
                      <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
                    ) : (
                      <span className="size-4 shrink-0 rounded-full border border-line-strong" />
                    )}
                    <span className="shrink-0 font-mono text-[11px] text-ink-faint">{taskNum(t.id)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.title}</span>
                  </button>
                ))}
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

/* ── Validate — the Spec audit chat, applied to the plan ────────────────────── */
function ValidateStage({
  projectName,
  planMd,
  readOnly,
  mmaReady,
  driving,
  rounds,
  locked,
  auditClean,
  onRunAudit,
  onLock,
}: {
  projectName: string;
  planMd: string;
  readOnly: boolean;
  mmaReady: boolean;
  driving: boolean;
  rounds: { passNo: number; verdict: 'clean' | 'revised'; findings: PlanAuditFinding[] }[];
  locked: boolean;
  auditClean: boolean;
  onRunAudit: () => void;
  onLock: () => void;
}) {
  const md = planMd;
  const [version, setVersion] = useState(1);
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    { id: nid(), role: 'forge', text: "Here's the assembled plan below. Run an audit to check sequencing, coverage and TDD gaps; re-construct it after we discuss changes; then lock it." },
    { id: nid(), role: 'draft', md, version: 1 },
  ]);
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
          text: r.verdict === 'clean' ? 'Clean pass — no critical or high. You can lock the plan.' : 'Pick the findings to apply, or tell me by number — I’ll revise the plan and you re-run.',
        } as Msg,
      ]),
    ]);
  }, [rounds]);

  function apply(passNo: number, indices: number[], total: number) {
    if (readOnly || indices.length === 0) return;
    const label = indices.length === total ? `all ${total} findings` : `finding${indices.length === 1 ? '' : 's'} #${indices.map((i) => i + 1).sort((a, b) => a - b).join(', #')}`;
    setMsgs((m) => [...m, { id: nid(), role: 'forge', text: `Applied ${label} from pass ${passNo} — revised the plan. Re-run the audit to verify.` }]);
  }
  function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMsgs((m) => [...m, { id: nid(), role: 'user', text }, { id: nid(), role: 'forge', text: 'Noted — hit “Re-construct plan” to regenerate it with that, or re-run the audit.' }]);
  }
  function reconstruct() {
    if (readOnly) return;
    const v = version + 1;
    setVersion(v);
    setMsgs((m) => [
      ...m,
      { id: nid(), role: 'forge', text: `Re-constructed the plan from our discussion — v${v}.` },
      { id: nid(), role: 'draft', md, version: v },
    ]);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE — finalize the plan in dialogue (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle>{projectName} — validate the plan</CardTitle>
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
        <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-surface-2/40 !py-5">
          {msgs.map((m) =>
            m.role === 'user' ? (
              <ChatUser key={m.id} text={m.text} />
            ) : m.role === 'audit' ? (
              <AuditChatMsg key={m.id} passNo={m.passNo} verdict={m.verdict} findings={m.findings} readOnly={readOnly} onApply={(idx) => apply(m.passNo, idx, m.findings.length)} />
            ) : m.role === 'draft' ? (
              <PlanDraftBubble key={m.id} md={m.md} version={m.version} />
            ) : (
              <ChatForge key={m.id}>{m.text}</ChatForge>
            ),
          )}
          <div ref={bottomRef} />
        </CardContent>
        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          secondaries={[
            { label: rounds.length > 0 ? 'Re-run audit' : 'Run audit', icon: <Shield />, onClick: onRunAudit, disabled: readOnly || !mmaReady || locked || auditClean },
            { label: version > 1 ? 'Re-construct plan' : 'Construct plan', icon: <Sparkles />, onClick: reconstruct, disabled: readOnly || locked },
          ]}
          placeholder="Discuss the plan — “address the sequencing finding”…"
          disabled={readOnly || driving}
        />
      </Card>

      {/* RIGHT — audit rounds + Lock the plan (1/3) */}
      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Audit rounds</CardTitle>
            {rounds.length > 0 ? <span className="text-sm font-medium text-ink-faint">{rounds.length}</span> : null}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto !py-4">
            {rounds.length === 0 ? (
              <div className="flex items-start gap-3 rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3">
                <Shield className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <p className="text-xs leading-relaxed text-ink-soft">
                  Run the audit from the conversation. {driving ? 'The AI clears critical & high, then locks.' : 'Each round lands here with its severity summary.'}
                </p>
              </div>
            ) : (
              rounds.map((r) => <AuditRoundCard key={r.passNo} round={r} />)
            )}
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <TextSm className="!text-ink-faint">
              {auditClean
                ? 'Clean audit — locking opens Build and runs the plan task-by-task.'
                : 'Locking opens Build and starts Execution. Open findings won’t block it.'}
            </TextSm>
            <StageAdvance
              onClick={onLock}
              label={locked ? 'Opening Build…' : 'Lock the plan & start Build'}
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

/* ── audit message: numbered, selectable findings + apply (shared w/ Spec) ──── */
function SeverityTag({ s }: { s: PlanAuditFinding['severity'] }) {
  return (
    <span className={cn('inline-flex w-[58px] shrink-0 items-center justify-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SEVERITY_STYLE[s])}>
      {s}
    </span>
  );
}

function AuditChatMsg({
  passNo,
  verdict,
  findings,
  readOnly,
  onApply,
}: {
  passNo: number;
  verdict: 'clean' | 'revised';
  findings: PlanAuditFinding[];
  readOnly: boolean;
  onApply: (indices: number[]) => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
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
        </div>
        <div className="overflow-hidden rounded-2xl rounded-tl-md border border-line bg-surface shadow-sm">
          {findings.length > 0 ? (
            <>
              <ul className="divide-y divide-line/70">
                {findings.map((f, i) => {
                  const on = sel.has(i);
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => !readOnly && toggle(i)} disabled={readOnly} className={cn('flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors', on ? 'bg-accent-tint/40' : 'hover:bg-surface-2/50')}>
                        <span className={cn('mt-px grid size-5 shrink-0 place-items-center rounded-[6px] border text-[11px] font-semibold transition-colors', on ? 'border-accent bg-accent text-white' : 'border-line-strong text-ink-faint')}>
                          {on ? <Check className="size-3.5" /> : i + 1}
                        </span>
                        <SeverityTag s={f.severity} />
                        <span className="text-sm leading-relaxed text-ink">{f.claim}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/40 px-3.5 py-2.5">
                <span className="text-[11px] text-ink-faint">Pick the ones to apply, or tell Forge by number.</span>
                <span className="flex-1" />
                <Button size="sm" variant="secondary" onClick={() => onApply([...sel])} disabled={readOnly || sel.size === 0} leftIcon={<Check />}>
                  Apply selected{sel.size > 0 ? ` (${sel.size})` : ''}
                </Button>
                <Button size="sm" onClick={() => onApply(findings.map((_, i) => i))} disabled={readOnly} leftIcon={<Sparkles />}>
                  Apply all {findings.length}
                </Button>
              </div>
            </>
          ) : (
            <p className="px-4 py-3 text-sm leading-relaxed text-ink">No critical or high findings — the plan is ready to lock.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditRoundCard({ round }: { round: { passNo: number; verdict: 'clean' | 'revised'; findings: PlanAuditFinding[] } }) {
  const counts: Record<PlanAuditFinding['severity'], number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of round.findings) counts[f.severity] += 1;
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-ink">Pass {round.passNo}</span>
        <Badge variant={round.verdict === 'clean' ? 'sage' : 'neutral'} size="sm">
          {round.verdict}
        </Badge>
        <span className="ml-auto text-[11px] text-ink-faint">
          {round.findings.length} finding{round.findings.length === 1 ? '' : 's'}
        </span>
      </div>
      {round.findings.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <span key={s} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', SEVERITY_STYLE[s])}>
              <span className="font-semibold">{counts[s]}</span>
              {s}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-ink-faint">No critical or high findings.</p>
      )}
    </div>
  );
}
