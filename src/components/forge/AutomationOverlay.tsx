'use client';

import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useProjectEvents } from '@/hooks/useProjectEvents';
import {
  Bot,
  Square,
  Loader2,
  Check,
  AlertTriangle,
  BookOpen,
  FileText,
  ListTree,
  Rocket,
  ScanSearch,
  NotebookPen,
  Clock,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format-date';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
} from '@/components/ui';
import { RailNote } from '@/components/patterns/feature-rail';
import { automationOverlayStore } from '@/components/forge/AutomationGate';

const AUTOMATION_NOTE = `### What is this?

- Forge drives every stage step-by-step, as if a human is clicking
- Audit loops run up to 5 passes or until no critical/high findings
- Each plan task gets self-validation before approval
- You can stop anytime and take over manually`;

const STAGES = [
  { key: 'exploration', label: 'Explore', icon: BookOpen, phases: [
    { key: 'brief', label: 'Brief' },
    { key: 'discover', label: 'Discover' },
    { key: 'synthesize', label: 'Synthesize' },
  ]},
  { key: 'spec', label: 'Spec', icon: FileText, phases: [
    { key: 'outline', label: 'Outline' },
    { key: 'craft', label: 'Craft' },
    { key: 'finalize', label: 'Finalize' },
  ]},
  { key: 'plan', label: 'Plan', icon: ListTree, phases: [
    { key: 'refine', label: 'Refine' },
    { key: 'validate', label: 'Validate' },
  ]},
  { key: 'execute', label: 'Execute', icon: Rocket, phases: [
    { key: 'configure', label: 'Configure' },
    { key: 'monitor', label: 'Monitor' },
  ]},
  { key: 'review', label: 'Review', icon: ScanSearch, phases: [
    { key: 'review', label: 'Review' },
  ]},
  { key: 'journal', label: 'Reflect', icon: NotebookPen, phases: [
    { key: 'journal', label: 'Journal' },
    { key: 'summary', label: 'Summary' },
  ]},
] as const;

const STAGE_ORDER = STAGES.map((s) => s.key);
type StageKey = typeof STAGE_ORDER[number];

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/** Compact per-activity duration, e.g. "0.4s", "12.6s", "2m 3s". */
function formatDur(ms: number): string {
  if (ms < 950) return `${Math.max(0, Math.round(ms / 100) / 10)}s`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2 last:border-0">
      <span className="flex items-center gap-1.5 text-xs text-ink-faint">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

interface Props {
  projectId: string;
  projectName: string;
  autoMode: boolean;
  autoNote: string;
  currentStage: string;
  phase: string;
  stagePhase?: string;
  automationStartedAt?: string;
  events?: Array<{ stage: string; phase: string; detail: string; kind?: 'action' | 'error' | 'done'; durationMs?: number; at: string }>;
}

type LineKind = 'action' | 'error' | 'done';
type LogLine = { time: string; startedAt: number; text: string; kind: LineKind; done: boolean; error?: boolean; durationMs?: number };

/** The project-level event log (`details.events`) IS the activity feed — the same
 * records the live stream emits, plus a milestone line per completed MMA batch
 * across every stage. Seeding from it makes a refresh lossless and shows the FULL
 * project timeline (explore→journal), not just this automation run. Duration comes
 * from the gap to the next line; the final `action` line stays open (running). */
function seedLogs(events: Array<{ detail: string; kind?: LineKind; durationMs?: number; at: string }>): LogLine[] {
  return events.map((s, i) => {
    const startedAt = new Date(s.at).getTime();
    const kind: LineKind = s.kind ?? 'action';
    const running = i === events.length - 1 && kind === 'action'; // last action = still in progress
    return {
      time: formatTime(new Date(startedAt)),
      startedAt,
      text: s.detail,
      kind,
      done: !running,
      error: kind === 'error',
      // Completed lines show their measured work time (absent for instantaneous
      // approvals). The running line has no stored duration — the UI ticks it live.
      durationMs: running ? undefined : s.durationMs,
    };
  });
}

export function AutomationOverlay({ projectId, projectName, autoMode, autoNote, currentStage, phase, stagePhase, automationStartedAt, events }: Props) {
  const router = useRouter();
  // Subscribe to the project SSE stream while driving (the layout doesn't mount
  // this — only ExploreStageClient does — so without this the overlay would get
  // no live progress on spec/plan/execute/review/journal pages).
  useProjectEvents(projectId);
  // Read-only viewing (opened via the topbar "Activity" button on a non-auto /
  // completed project) → no 3-2-1 countdown, header says "Project activity",
  // and the action becomes "Close" instead of "Stop & take over".
  const viewOnly = useSyncExternalStore(automationOverlayStore.subscribe, automationOverlayStore.isViewOnly, () => false);
  const [countdown, setCountdown] = useState(autoMode || viewOnly ? 0 : 3);
  // Mirror countdown into a ref so the (long-lived) SSE handlers can read it
  // without re-subscribing — used to hold server refreshes until the intro ends.
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;
  const [liveNote, setLiveNote] = useState(autoMode ? autoNote : 'Starting in 3...');
  const [liveStage, setLiveStage] = useState(currentStage);
  const [livePhase, setLivePhase] = useState(stagePhase ?? phase);
  // The project-level event log IS the feed — seeding from it makes a refresh
  // lossless (elapsed is seeded from automationStartedAt below, so the timer
  // doesn't reset either). Live SSE lines carry the same records and stream on top.
  const [logs, setLogs] = useState<LogLine[]>(() => seedLogs(events ?? []));
  const startTime = useRef(automationStartedAt ? new Date(automationStartedAt).getTime() : Date.now());
  const [elapsed, setElapsed] = useState(automationStartedAt ? Date.now() - new Date(automationStartedAt).getTime() : 0);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Brief 3-2-1 intro. Ticks purely off `countdown` — NOT `autoMode` — so it can
  // never freeze when the server flips autoMode true mid-countdown (which used to
  // early-return and leave it stuck at 3). Each tick reschedules until it hits 0.
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // When the intro ends, sync the server state once — the top stepper/summary
  // held still during the countdown (see onStepDone) so they didn't jump around
  // while Forge was already advancing spec→plan behind the "Getting ready" screen.
  useEffect(() => {
    if (countdown === 0) router.refresh();
  }, [countdown, router]);

  // Adopt the current run's start time for the elapsed clock. The activity log is
  // project-level (details.events) and is NEVER cleared — a new run keeps the full
  // timeline and only restarts the elapsed timer (startedAt is per-run).
  const adoptedStartRef = useRef<string | undefined>(automationStartedAt);
  useEffect(() => {
    if (!automationStartedAt) return;
    if (automationStartedAt === adoptedStartRef.current) return; // same run — nothing to do
    adoptedStartRef.current = automationStartedAt;
    const ts = new Date(automationStartedAt).getTime();
    startTime.current = ts;
    setElapsed(Date.now() - ts);
  }, [automationStartedAt]);

  // Elapsed time ticker
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startTime.current), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (autoNote) setLiveNote(autoNote); }, [autoNote]);
  useEffect(() => { setLiveStage(currentStage); }, [currentStage]);

  // One line per activity: an `action` line spins with a live-ticking duration
  // until its terminal (`done`/`error`) RESOLVES it in place — stamping the real
  // measured duration and the settled label (no separate start/finish pair). A
  // terminal with no running line to resolve (e.g. a manual dispatch) lands fresh.
  const addLog = useCallback((text: string, kind: LineKind = 'action', durationMs?: number) => {
    setLogs((prev) => {
      if (kind === 'done' || kind === 'error') {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (!prev[i].done && prev[i].kind === 'action') {
            const copy = prev.slice();
            copy[i] = { ...copy[i], kind, done: true, error: kind === 'error', text, durationMs };
            return copy;
          }
        }
        const now = Date.now();
        const closed = prev.map((l) => (l.done ? l : { ...l, done: true, durationMs: l.durationMs ?? now - l.startedAt }));
        return [...closed, { time: formatTime(new Date(now)), startedAt: now, text, kind, done: true, error: kind === 'error', durationMs }];
      }
      const last = prev[prev.length - 1];
      if (last && last.text === text && !last.done) return prev; // no duplicate running line
      const now = Date.now();
      const closed = prev.map((l) => (l.done ? l : { ...l, done: true, durationMs: l.durationMs ?? now - l.startedAt }));
      return [...closed, { time: formatTime(new Date(now)), startedAt: now, text, kind: 'action', done: false }];
    });
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    function onProgress(e: Event) {
      const d = (e as CustomEvent).detail as { note?: string; stage?: string; phase?: string; kind?: LineKind; durationMs?: number };
      if (d?.note) { setLiveNote(d.note); addLog(d.note, d.kind ?? 'action', d.durationMs); }
      if (d?.stage) setLiveStage(d.stage);
      if (d?.phase) setLivePhase(d.phase);
    }
    function onStepDone(e: Event) {
      // A server-side action completed — sync stage/phase and re-pull server state
      // (stepper/summary). The log line itself finalizes when the next line lands.
      // Hold the server refresh until the intro countdown ends so the top stepper
      // doesn't jump while Forge is already advancing behind "Getting ready".
      const d = (e as CustomEvent).detail as { step?: string; stage?: string; phase?: string };
      if (d?.stage) setLiveStage(d.stage);
      if (d?.phase) setLivePhase(d.phase);
      if (countdownRef.current <= 0) router.refresh();
    }
    function onError(e: Event) {
      // The driver already emitted the error as a persisted progress line — don't
      // duplicate it; just note it and re-pull (auto-mode is now off server-side).
      const d = (e as CustomEvent).detail as { error?: string };
      if (d?.error) setLiveNote(`Error: ${d.error}`);
      if (countdownRef.current <= 0) router.refresh();
    }
    window.addEventListener('automation:progress', onProgress);
    window.addEventListener('automation:step_done', onStepDone);
    window.addEventListener('automation:error', onError);
    return () => {
      window.removeEventListener('automation:progress', onProgress);
      window.removeEventListener('automation:step_done', onStepDone);
      window.removeEventListener('automation:error', onError);
    };
  }, [router, addLog]);

  // Steps completed = completed milestones (one `done` line per finished MMA batch,
  // plus the final "all stages complete"). Counting `done` lines avoids double-
  // counting the driver's live `action` line against its terminal milestone, and
  // is accurate in manual mode too. Derived from the log so it survives a refresh.
  const stepsCompleted = logs.filter((l) => l.kind === 'done').length;

  const currentIdx = STAGE_ORDER.indexOf(liveStage as StageKey);

  // Richer live metrics, all derived from the event log (so they update as lines
  // stream AND survive a refresh — no server round-trip). Each counts the settled
  // milestone lines of a kind of work Forge did across the whole project.
  const count = (re: RegExp) => logs.filter((l) => l.done && re.test(l.text)).length;
  const stats = {
    stageOfTotal: `${Math.min(currentIdx + 1, STAGE_ORDER.length)} of ${STAGE_ORDER.length}`,
    audits: count(/^Audited (spec|plan)/),
    tasksApproved: count(/approved task/i),
    reviews: count(/^Reviewed code/),
    learnings: count(/kept learning|Recorded learnings/i),
    issues: logs.filter((l) => l.error).length,
  };

  function stageStatus(key: string): 'done' | 'active' | 'pending' {
    const idx = STAGE_ORDER.indexOf(key as StageKey);
    if (idx < currentIdx) return 'done';
    if (idx === currentIdx) return 'active';
    return 'pending';
  }

  function phaseStatus(stgKey: string, phKey: string, phIdx: number, stg: 'done' | 'active' | 'pending') {
    if (stg === 'done') return 'done' as const;
    if (stg === 'pending') return 'pending' as const;
    // Active stage — check if current phase matches
    const stgDef = STAGES.find((s) => s.key === stgKey);
    if (!stgDef) return 'pending' as const;
    const livePIdx = stgDef.phases.findIndex((p) => p.key === livePhase);
    if (livePIdx < 0) return phIdx === 0 ? 'active' as const : 'pending' as const;
    if (phIdx < livePIdx) return 'done' as const;
    if (phIdx === livePIdx) return 'active' as const;
    return 'pending' as const;
  }

  async function handleStop() {
    await fetch(`/api/projects/${projectId}/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'take_over' }),
    });
    automationOverlayStore.hide();
    router.refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Automation / activity bar */}
      <div className={cn('flex shrink-0 items-center gap-3 rounded-[var(--r-lg)] border px-4 py-3', viewOnly ? 'border-line bg-surface-2/50' : 'border-accent/40 bg-accent-tint/40')}>
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-white', viewOnly ? 'bg-ink-soft' : 'bg-accent')}>
          {countdown > 0 ? <span className="text-lg font-bold tabular-nums">{countdown}</span> : viewOnly ? <ListTree className="size-5" /> : <Bot className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            {viewOnly ? 'Project activity' : countdown > 0 ? 'Getting ready...' : 'Forge is driving'}
            {!viewOnly && countdown <= 0 && autoMode && <span className="inline-flex size-1.5 animate-pulse rounded-full bg-accent" />}
          </p>
          <p className="truncate text-xs text-ink-soft">
            {viewOnly ? 'The full record of everything Forge did on this project' : countdown > 0 ? `Starting in ${countdown}...` : 'Running every step automatically — watch progress below'}
          </p>
        </div>
        {viewOnly ? (
          <Button size="sm" variant="secondary" onClick={() => automationOverlayStore.hide()}>
            Close
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={handleStop} leftIcon={<Square />}>
            Stop &amp; take over
          </Button>
        )}
      </div>

      {/* Content — 2/3 pipeline + 1/3 details */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">

        {/* LEFT 2/3 — What Forge has done */}
        <Card className="flex min-h-0 flex-col lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            {logs.length > 0 && <Badge variant="neutral" size="sm">{logs.length}</Badge>}
          </CardHeader>

          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            {countdown > 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16">
                <p className="text-sm text-ink-faint">Waiting to start…</p>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16">
                <Loader2 className="size-6 animate-spin text-accent" />
                <p className="text-sm text-ink-faint">Running first action...</p>
              </div>
            ) : (
              <>
                {logs.map((l, i) => {
                  const dur = l.done ? l.durationMs : elapsed >= 0 ? Date.now() - l.startedAt : 0;
                  return (
                    <div key={i} className="flex items-start gap-3 border-b border-line/40 py-2 last:border-0">
                      <span className="mt-px min-w-[36px] font-mono text-[10px] text-ink-faint">{l.time}</span>
                      {l.error ? (
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger,#c0492f)]" />
                      ) : l.done ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--sage)]" />
                      ) : (
                        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent" />
                      )}
                      <span className={cn('flex-1 text-sm', l.error ? 'text-[var(--danger,#c0492f)]' : l.done ? 'text-ink' : 'font-medium text-accent')}>
                        {l.text}
                      </span>
                      {dur != null && (
                        <span className={cn('mt-0.5 shrink-0 font-mono text-[10px] tabular-nums', l.done ? 'text-ink-faint' : 'text-accent/70')}>
                          {formatDur(dur)}
                        </span>
                      )}
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </>
            )}
          </CardContent>
        </Card>

        {/* RIGHT 1/3 — Rail: note + stats */}
        <aside className="flex min-h-0 flex-col gap-4">
          <RailNote icon={<Bot />}>{AUTOMATION_NOTE}</RailNote>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 !py-4">
              {/* Progress */}
              <Stat label={viewOnly ? 'Final stage' : 'Current stage'} value={STAGES.find((s) => s.key === liveStage)?.label ?? liveStage} icon={<Bot className="size-3" />} />
              <Stat label="Stage" value={stats.stageOfTotal} icon={<Rocket className="size-3" />} />
              {/* Elapsed is a live run clock — meaningless for a historical view. */}
              {!viewOnly && <Stat label="Time elapsed" value={formatElapsed(elapsed)} icon={<Clock className="size-3" />} />}
              <Stat label={viewOnly ? 'Activities' : 'Steps completed'} value={`${viewOnly ? logs.length : stepsCompleted}`} icon={<Zap className="size-3" />} />

              {/* Work done — each row appears only once that work has happened, so
                  the panel fills in as Forge progresses instead of showing zeros. */}
              {(stats.audits > 0 || stats.tasksApproved > 0 || stats.reviews > 0 || stats.learnings > 0 || stats.issues > 0) && (
                <div className="!mt-3 space-y-2.5 border-t border-line pt-3">
                  {stats.audits > 0 && <Stat label="Audits run" value={`${stats.audits}`} icon={<FileText className="size-3" />} />}
                  {stats.tasksApproved > 0 && <Stat label="Tasks approved" value={`${stats.tasksApproved}`} icon={<ListTree className="size-3" />} />}
                  {stats.reviews > 0 && <Stat label="Code reviews" value={`${stats.reviews}`} icon={<ScanSearch className="size-3" />} />}
                  {stats.learnings > 0 && <Stat label="Learnings" value={`${stats.learnings}`} icon={<NotebookPen className="size-3" />} />}
                  {stats.issues > 0 && <Stat label="Issues" value={`${stats.issues}`} icon={<AlertTriangle className="size-3" />} />}
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
