'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  GitBranch,
  Rocket,
  Boxes,
  FileCode,
  Circle,
  XCircle,
  Clock,
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

export interface ExecUnit {
  id: string;
  num: number;
  title: string;
  repo: string;
  dependsOn: string[];
  filesCount: number;
  dbStatus?: string;
  branch?: string | null;
  commitSha?: string | null;
}

type ExecPhase = 'dispatch' | 'run' | 'land';

export interface ExecuteStageClientProps {
  projectId: string;
  projectName: string;
  planVersion: number;
  phase: ProjectPhase;
  mmaReady: boolean;
  units: ExecUnit[];
  writeTargets: string[];
}

/** Job-level state driven by SSE dispatch.progress events. */
interface JobProgress {
  phase: string;
  elapsedMs: number;
  totalTasks: number;
}

/** Terminal result populated from dispatch.done + page refresh. */
type TerminalResult = 'committed' | 'failed' | null;

function inferPhase(units: ExecUnit[]): ExecPhase {
  if (units.length === 0) return 'dispatch';
  const hasStarted = units.some((u) => u.dbStatus && u.dbStatus !== 'queued');
  if (!hasStarted) return 'dispatch';
  const allTerminal = units.every((u) => u.dbStatus === 'committed' || u.dbStatus === 'failed' || u.dbStatus === 'skipped');
  if (allTerminal) return 'land';
  return 'run';
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

const PHASE_LABEL: Record<string, string> = {
  implementing: 'Implementing',
  reviewing: 'Reviewing',
  running: 'Running',
};

export function ExecuteStageClient(props: ExecuteStageClientProps) {
  const router = useRouter();
  const readOnly = props.phase === 'learn';
  const { units } = props;

  const initialPhase = inferPhase(units);
  const [phase, setPhase] = useState<ExecPhase>(initialPhase);
  const [maxPhase, setMaxPhase] = useState<ExecPhase>(initialPhase);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress>({ phase: 'implementing', elapsedMs: 0, totalTasks: units.length });
  const [terminalResult, setTerminalResult] = useState<TerminalResult>(
    initialPhase === 'land'
      ? units.every((u) => u.dbStatus === 'committed') ? 'committed' : 'failed'
      : null,
  );
  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');

  const PHASE_ORDER: ExecPhase[] = ['dispatch', 'run', 'land'];
  const advancePhase = (next: ExecPhase) => {
    setPhase(next);
    setMaxPhase((prev) => PHASE_ORDER.indexOf(next) > PHASE_ORDER.indexOf(prev) ? next : prev);
  };

  useEffect(() => stagePhaseStore.set(phase), [phase]);
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        const target = key as ExecPhase;
        if (PHASE_ORDER.includes(target) && PHASE_ORDER.indexOf(target) <= PHASE_ORDER.indexOf(maxPhase)) {
          setPhase(target);
        }
      }),
    [maxPhase],
  );

  useEffect(() => {
    if (readOnly) return;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      setAutoNote('Forge is driving — dispatching the plan…');
      setAuto('running');
    }
  }, [readOnly]);

  // SSE listener: job-level progress + terminal events
  useEffect(() => {
    if (phase !== 'run') return;
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/projects/${props.projectId}/events`);
    es.onmessage = (msg) => {
      try {
        const e = JSON.parse(msg.data) as Record<string, unknown>;
        if (e.type === 'dispatch.progress' && e.handler === 'execute-pipeline') {
          setJobProgress({
            phase: (e.phase as string) ?? 'running',
            elapsedMs: (e.elapsedMs as number) ?? 0,
            totalTasks: (e.totalTasks as number) ?? units.length,
          });
        }
        if (e.type === 'dispatch.done' && e.handler === 'execute-pipeline') {
          setTerminalResult('committed');
          advancePhase('land');
        }
        if (e.type === 'dispatch.failed' && e.handler === 'execute-pipeline') {
          setTerminalResult('failed');
          advancePhase('land');
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, props.projectId]);

  // Automated driver
  useEffect(() => {
    if (auto !== 'running' || readOnly) return;
    const t = setTimeout(() => {
      if (phase === 'dispatch') {
        setAutoNote('Dispatched the plan to MMA execute-plan…');
        advancePhase('run');
      } else if (phase === 'land') {
        router.push(`/projects/${props.projectId}/review?auto=1`);
      }
    }, 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, phase, readOnly]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="execute-stage">
      {!props.mmaReady ? (
        <Banner
          variant="warning"
          title="The MMA token is not configured."
          description={
            <>
              <a href="/settings/connections" className="font-medium underline">Configure the MMA token</a>{' '}
              to dispatch the plan to workers.
            </>
          }
        />
      ) : null}

      <AutomationBar
        mode={auto}
        note={autoNote}
        disabled={readOnly}
        idleHint="Dispatch the plan yourself and watch it run, or let Forge run Execute → Review → Journal."
        runningHint="Forge dispatches the plan, runs every task, lands the commits, then hands off to review. Stop anytime."
        onRun={() => { setAutoNote('Forge is driving — dispatching the plan…'); setAuto('running'); }}
        onStop={() => { setAuto('off'); setAutoNote('Stopped — you have the wheel.'); }}
      />

      {phase === 'dispatch' ? (
        <DispatchStage
          projectName={props.projectName}
          planVersion={props.planVersion}
          units={units}
          writeTargets={props.writeTargets}
          readOnly={readOnly}
          dispatching={dispatching}
          dispatchError={dispatchError}
          onDispatch={async () => {
            setDispatching(true);
            setDispatchError(null);
            try {
              const res = await fetch(`/api/projects/${props.projectId}/build/start-execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
              });
              if (res.status === 202) {
                setDispatching(false);
                advancePhase('run');
              } else {
                const ct = res.headers.get('content-type') ?? '';
                let msg: string;
                if (ct.includes('application/json')) {
                  const json = await res.json().catch(() => ({})) as { error?: string };
                  msg = json.error ?? `Dispatch failed (HTTP ${res.status})`;
                } else if (res.status === 404) {
                  msg = 'Execute endpoint not found — the MMA service may not be configured.';
                } else {
                  msg = `Dispatch failed (HTTP ${res.status})`;
                }
                setDispatchError(msg);
                setDispatching(false);
              }
            } catch {
              setDispatchError('Network error');
              setDispatching(false);
            }
          }}
        />
      ) : phase === 'run' ? (
        <RunStage
          projectName={props.projectName}
          units={units}
          writeTargets={props.writeTargets}
          progress={jobProgress}
        />
      ) : (
        <LandStage
          projectId={props.projectId}
          projectName={props.projectName}
          units={units}
          writeTargets={props.writeTargets}
          terminalResult={terminalResult}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

/* ── Dispatch ─────────────────────────────────────────────────────────────── */
function DispatchStage({
  projectName, planVersion, units, writeTargets, readOnly, onDispatch, dispatching, dispatchError,
}: {
  projectName: string; planVersion: number; units: ExecUnit[]; writeTargets: string[];
  readOnly: boolean; onDispatch: () => void; dispatching?: boolean; dispatchError?: string | null;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <Boxes className="size-4 shrink-0 text-accent" />
            <CardTitle>Execution queue</CardTitle>
            <Badge variant="neutral" size="sm">{units.length} tasks</Badge>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
            <Rocket className="size-3" /> MMA execute-plan
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-4">
          {units.map((u) => (
            <div key={u.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
              <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-surface-2 font-mono text-[10px] font-semibold text-ink-soft">{u.num}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.title}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                <GitBranch className="size-2.5" /> {u.repo}
              </span>
              <Circle className="size-3 shrink-0 text-line-strong" />
            </div>
          ))}
        </CardContent>
      </Card>

      <aside className="flex min-h-0 flex-col gap-4">
        <div className="flex shrink-0 items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/30 px-4 py-4">
          <Rocket className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0">
            <Eyebrow as="h3" className="text-accent-deep">Ready to execute</Eyebrow>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
              Forge hands the plan to MMA execute-plan. All tasks run in one session inside an isolated worktree. Changes merge back when done.
            </p>
          </div>
        </div>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>{projectName}</CardTitle>
            <Badge variant="sage" size="sm">plan · v{planVersion}</Badge>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <Stat label="Tasks" value={`${units.length}`} />
            <Stat label="Write targets" value={`${writeTargets.length}`} />
            <div className="flex flex-wrap gap-1.5">
              {writeTargets.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-soft">
                  <GitBranch className="size-2.5" /> {r}
                </span>
              ))}
            </div>
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            {dispatchError ? <p className="text-sm text-[var(--rose)]">{dispatchError}</p> : null}
            <Button className="w-full" onClick={onDispatch} disabled={readOnly || dispatching} loading={dispatching} leftIcon={<Rocket />}>
              {dispatching ? 'Dispatching…' : 'Dispatch to workers'}
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2 last:border-0">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

/* ── Run — 3-col grid matching Dispatch/Land layout ───────────────────────── */
function RunStage({
  projectName, units, writeTargets, progress,
}: {
  projectName: string; units: ExecUnit[]; writeTargets: string[]; progress: JobProgress;
}) {
  const phaseLabel = PHASE_LABEL[progress.phase] ?? progress.phase;
  const isReviewing = progress.phase === 'reviewing';
  const progressPct = isReviewing ? 85 : 45;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE — task list with executing overlay (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
            <CardTitle>Executing…</CardTitle>
            <Badge variant="neutral" size="sm">{progress.totalTasks} tasks</Badge>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-tint px-2.5 py-1 text-[11px] font-medium text-accent-deep">
            <Rocket className="size-3" /> {phaseLabel}
          </span>
        </CardHeader>

        {/* Progress bar */}
        <div className="px-5">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-all duration-1000"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-4">
          {units.map((u) => (
            <div key={u.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 opacity-60">
              <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-surface-2 font-mono text-[10px] font-semibold text-ink-soft">{u.num}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.title}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                <GitBranch className="size-2.5" /> {u.repo}
              </span>
              <Loader2 className="size-3 shrink-0 animate-spin text-accent" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* RIGHT — run status panel (1/3) */}
      <aside className="flex min-h-0 flex-col gap-4">
        {/* Phase card */}
        <div className="flex shrink-0 flex-col gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/30 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'grid size-8 place-items-center rounded-full',
              isReviewing ? 'bg-[var(--sage-tint)]' : 'bg-accent-tint',
            )}>
              {isReviewing
                ? <CheckCircle2 className="size-4 text-[var(--sage-deep)]" />
                : <Rocket className="size-4 text-accent" />
              }
            </div>
            <div>
              <Eyebrow as="h3" className="text-accent-deep">{phaseLabel}</Eyebrow>
              <p className="mt-0.5 text-xs text-ink-soft">
                {isReviewing
                  ? 'Reviewer verifying the implementation'
                  : 'Implementer working through tasks sequentially'
                }
              </p>
            </div>
          </div>

          {/* Phase pipeline */}
          <div className="flex items-center gap-1.5">
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
              isReviewing ? 'bg-[var(--sage-tint)] text-[var(--sage-deep)]' : 'bg-white/80 text-accent-deep',
            )}>
              {isReviewing ? <CheckCircle2 className="size-2.5" /> : <Loader2 className="size-2.5 animate-spin" />}
              Implement
            </span>
            <ArrowRight className="size-2.5 text-accent/40" />
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
              isReviewing ? 'bg-white/80 text-accent-deep' : 'text-ink-faint',
            )}>
              {isReviewing ? <Loader2 className="size-2.5 animate-spin" /> : <Circle className="size-2.5" />}
              Review
            </span>
            <ArrowRight className="size-2.5 text-accent/40" />
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink-faint">
              <Circle className="size-2.5" /> Merge
            </span>
          </div>
        </div>

        {/* Stats card */}
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>{projectName}</CardTitle>
            <Badge variant="neutral" size="sm">running</Badge>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <Stat label="Tasks" value={`${progress.totalTasks}`} />
            <Stat label="Write targets" value={`${writeTargets.length}`} />
            <Stat label="Elapsed" value={formatElapsed(progress.elapsedMs)} />
            <Stat label="Phase" value={phaseLabel} />
            <div className="flex flex-wrap gap-1.5">
              {writeTargets.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-soft">
                  <GitBranch className="size-2.5" /> {r}
                </span>
              ))}
            </div>
          </CardContent>
          <CardFooter>
            <div className="flex w-full items-center justify-center gap-2 text-sm text-ink-soft">
              <Clock className="size-3.5" />
              <span className="font-mono font-medium text-ink">{formatElapsed(progress.elapsedMs)}</span>
            </div>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/* ── Land — per-task results from terminal envelope ───────────────────────── */
function LandStage({
  projectId, projectName, units, writeTargets, terminalResult, readOnly,
}: {
  projectId: string; projectName: string; units: ExecUnit[]; writeTargets: string[];
  terminalResult: TerminalResult; readOnly: boolean;
}) {
  const succeeded = terminalResult === 'committed';
  const committedCount = units.filter((u) => u.dbStatus === 'committed').length;
  const failedCount = units.filter((u) => u.dbStatus === 'failed').length;
  const totalFiles = useMemo(() => units.reduce((n, u) => n + u.filesCount, 0), [units]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            {succeeded
              ? <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
              : <XCircle className="size-4 shrink-0 text-[var(--rose)]" />
            }
            <CardTitle>{projectName} — {succeeded ? 'landed' : 'failed'}</CardTitle>
            <Badge variant={succeeded ? 'sage' : 'rose'} size="sm">
              {succeeded ? `${units.length} tasks committed` : `${failedCount} failed`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-4">
          {units.map((u) => {
            const isCommitted = u.dbStatus === 'committed';
            const isFailed = u.dbStatus === 'failed';
            return (
              <div key={u.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
                {isCommitted
                  ? <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
                  : isFailed
                    ? <XCircle className="size-4 shrink-0 text-[var(--rose)]" />
                    : <Circle className="size-4 shrink-0 text-line-strong" />
                }
                <span className="font-mono text-[10px] text-ink-faint">{u.num}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.title}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                  <GitBranch className="size-2.5" /> {u.repo}
                </span>
                {u.commitSha ? (
                  <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">{u.commitSha.slice(0, 7)}</span>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Landed</CardTitle>
            <Badge variant={succeeded ? 'sage' : 'rose'} size="sm">{succeeded ? 'complete' : 'issues'}</Badge>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <Stat label="Tasks" value={`${units.length}`} />
            <Stat label="Committed" value={`${committedCount}`} />
            {failedCount > 0 ? <Stat label="Failed" value={`${failedCount}`} /> : null}
            <Stat label="Repos" value={`${writeTargets.length}`} />
            <div className="flex flex-wrap gap-1.5">
              {writeTargets.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-soft">
                  <GitBranch className="size-2.5" /> {r}
                </span>
              ))}
            </div>
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <TextSm className="!text-ink-faint">
              {succeeded ? 'Execution done — the changes are ready for code review.' : 'Some tasks failed — review the results before continuing.'}
            </TextSm>
            <StageAdvance
              href={`/projects/${projectId}/review`}
              label="Continue to Review"
              disabled={readOnly}
              testId="execute-continue-link"
            />
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}
