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
import type { ExecUnit } from '@/mock/domains/projects/execute';

type ExecPhase = 'dispatch' | 'run' | 'land';
type RunStatus = 'queued' | 'running' | 'done';
interface RunState {
  status: RunStatus;
  headline?: string;
  branch?: string;
  commit?: string;
}

export interface ExecuteStageClientProps {
  projectId: string;
  projectName: string;
  planVersion: number;
  phase: ProjectPhase;
  mmaReady: boolean;
  units: ExecUnit[];
  writeTargets: string[];
}

const shaFor = (n: number) => ((n * 2654435761) >>> 0).toString(16).padStart(7, '0').slice(0, 7);
const branchFor = (u: ExecUnit) => `mma/exec-${u.repo.split('/').pop() ?? 'repo'}-${u.num}`;

export function ExecuteStageClient(props: ExecuteStageClientProps) {
  const router = useRouter();
  const readOnly = props.phase !== 'build';
  const { units } = props;

  const [phase, setPhase] = useState<ExecPhase>('dispatch');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [run, setRun] = useState<Record<string, RunState>>(
    () => Object.fromEntries(units.map((u) => [u.id, { status: 'queued' as RunStatus }])),
  );
  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');

  useEffect(() => stagePhaseStore.set(phase), [phase]);
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'dispatch') setPhase('dispatch');
        else if (key === 'run' || key === 'land') {
          // Run/Land are only reachable once the run has started.
          if (Object.values(run).some((r) => r.status !== 'queued')) setPhase(key as ExecPhase);
        }
      }),
    [run],
  );

  // Arriving from a locked plan in automated mode (?auto=1) → keep driving.
  useEffect(() => {
    if (readOnly) return;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      setAutoNote('Forge is driving — dispatching the plan…');
      setAuto('running');
    }
  }, [readOnly]);

  const doneCount = units.filter((u) => run[u.id]?.status === 'done').length;
  const allDone = units.length > 0 && doneCount === units.length;

  // The run itself: once dispatched (phase=run), MMA execute-plan walks the tasks
  // one-by-one — queued → running (headline) → done (branch + commit). Drives in
  // both manual and automated mode; automation only handles the phase gates.
  useEffect(() => {
    if (phase !== 'run') return;
    const running = units.find((u) => run[u.id]?.status === 'running');
    const queued = units.find((u) => run[u.id]?.status === 'queued');
    if (!running && !queued) return;
    const t = setTimeout(() => {
      setRun((prev) => {
        const next = { ...prev };
        if (running) next[running.id] = { status: 'done', branch: branchFor(running), commit: shaFor(running.num) };
        const q = units.find((u) => next[u.id]?.status === 'queued');
        if (q) next[q.id] = { status: 'running', headline: `Implementing “${q.title}” in ${q.repo}…` };
        return next;
      });
    }, 800);
    return () => clearTimeout(t);
  }, [phase, run, units]);

  // Automated driver: dispatch → run → (run drives itself) → land.
  useEffect(() => {
    if (auto !== 'running' || readOnly) return;
    const t = setTimeout(() => {
      if (phase === 'dispatch') {
        setAutoNote('Dispatched the locked plan to MMA execute-plan…');
        setPhase('run');
      } else if (phase === 'run' && allDone) {
        setAutoNote('All tasks landed — collecting commits.');
        setPhase('land');
      } else if (phase === 'land') {
        // Carry the automated run into code review.
        router.push(`/projects/${props.projectId}/review?auto=1`);
      }
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, phase, allDone, readOnly]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="execute-stage">
      {!props.mmaReady ? (
        <Banner
          variant="warning"
          title="The MMA token is not configured."
          description={
            <>
              <a href="/settings/connections" className="font-medium underline">
                Configure the MMA token
              </a>{' '}
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
        onRun={() => {
          setAutoNote('Forge is driving — dispatching the plan…');
          setAuto('running');
        }}
        onStop={() => {
          setAuto('off');
          setAutoNote('Stopped — you have the wheel.');
        }}
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
                router.push(`/projects/${props.projectId}/build`);
                router.refresh();
              } else {
                const data = await res.json().catch(() => ({ error: 'Unknown error' }));
                setDispatchError(data.error ?? 'Dispatch failed');
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
          units={units}
          run={run}
          doneCount={doneCount}
          allDone={allDone}
          onLand={() => setPhase('land')}
        />
      ) : (
        <LandStage
          projectId={props.projectId}
          projectName={props.projectName}
          units={units}
          run={run}
          writeTargets={props.writeTargets}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

/* ── Dispatch — hand the locked plan to MMA execute-plan ────────────────────── */
function DispatchStage({
  projectName,
  planVersion,
  units,
  writeTargets,
  readOnly,
  onDispatch,
  dispatching,
  dispatchError,
}: {
  projectName: string;
  planVersion: number;
  units: ExecUnit[];
  writeTargets: string[];
  readOnly: boolean;
  onDispatch: () => void;
  dispatching?: boolean;
  dispatchError?: string | null;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE — the execution queue (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <Boxes className="size-4 shrink-0 text-accent" />
            <CardTitle>Execution queue</CardTitle>
            <Badge variant="neutral" size="sm">
              {units.length} tasks
            </Badge>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
            <Rocket className="size-3" /> MMA execute-plan
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-4">
          {units.map((u) => (
            <div key={u.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
              <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-surface-2 font-mono text-[10px] font-semibold text-ink-soft">
                {u.num}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.title}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                <GitBranch className="size-2.5" /> {u.repo}
              </span>
              <Circle className="size-3 shrink-0 text-line-strong" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* RIGHT — dispatch panel (1/3) */}
      <aside className="flex min-h-0 flex-col gap-4">
        <div className="flex shrink-0 items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/30 px-4 py-4">
          <Rocket className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0">
            <Eyebrow as="h3" className="text-accent-deep">
              Ready to execute
            </Eyebrow>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
              Forge hands the locked plan to MMA execute-plan. Each task runs in its own worktree, one-by-one, landing a
              commit as it finishes.
            </p>
          </div>
        </div>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>{projectName}</CardTitle>
            <Badge variant="sage" size="sm">
              plan · v{planVersion}
            </Badge>
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

/* ── Run — live execution monitor ───────────────────────────────────────────── */
function RunStage({
  units,
  run,
  doneCount,
  allDone,
  onLand,
}: {
  units: ExecUnit[];
  run: Record<string, RunState>;
  doneCount: number;
  allDone: boolean;
  onLand: () => void;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE — live task execution (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            {allDone ? <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" /> : <Loader2 className="size-4 shrink-0 animate-spin text-accent" />}
            <CardTitle>{allDone ? 'Execution complete' : 'Executing…'}</CardTitle>
          </div>
          <span className="text-sm font-medium text-ink-faint">
            {doneCount}/{units.length}
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-4">
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-[var(--sage)] transition-all" style={{ width: `${(doneCount / units.length) * 100}%` }} />
          </div>
          {units.map((u) => {
            const r = run[u.id] ?? { status: 'queued' as RunStatus };
            return (
              <div
                key={u.id}
                className={cn(
                  'flex items-start gap-2.5 rounded-[var(--r-md)] border px-3 py-2 transition-colors',
                  r.status === 'running' ? 'border-accent bg-accent-tint/30' : 'border-line bg-surface',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {r.status === 'done' ? (
                    <CheckCircle2 className="size-4 text-[var(--sage)]" />
                  ) : r.status === 'running' ? (
                    <Loader2 className="size-4 animate-spin text-accent" />
                  ) : (
                    <Circle className="size-4 text-line-strong" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-ink-faint">{u.num}</span>
                    <span className="text-sm text-ink">{u.title}</span>
                  </div>
                  {r.status === 'running' && r.headline ? (
                    <p className="mt-0.5 truncate text-[11px] text-accent-deep">{r.headline}</p>
                  ) : r.status === 'done' && r.commit ? (
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                      <span className="inline-flex items-center gap-1">
                        <GitBranch className="size-2.5" /> {r.branch}
                      </span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{r.commit}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* RIGHT — run stats + land handoff (1/3) */}
      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Run</CardTitle>
            {allDone ? <Badge variant="sage" size="sm">done</Badge> : <Badge variant="neutral" size="sm">running</Badge>}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <Stat label="Completed" value={`${doneCount}/${units.length}`} />
            <Stat label="Running" value={`${units.filter((u) => run[u.id]?.status === 'running').length}`} />
            <Stat label="Queued" value={`${units.filter((u) => run[u.id]?.status === 'queued').length}`} />
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={onLand} disabled={!allDone} rightIcon={<ArrowRight />}>
              Land the changes
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/* ── Land — collected commits + handoff to Review ──────────────────────────── */
function LandStage({
  projectId,
  projectName,
  units,
  run,
  writeTargets,
  readOnly,
}: {
  projectId: string;
  projectName: string;
  units: ExecUnit[];
  run: Record<string, RunState>;
  writeTargets: string[];
  readOnly: boolean;
}) {
  const totalFiles = useMemo(() => units.reduce((n, u) => n + u.filesCount, 0), [units]);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* CENTRE — landed commits (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
            <CardTitle>{projectName} — landed</CardTitle>
            <Badge variant="sage" size="sm">
              {units.length} commits
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-1.5 overflow-y-auto !py-4">
          {units.map((u) => {
            const r = run[u.id];
            return (
              <div key={u.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
                <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
                <span className="font-mono text-[10px] text-ink-faint">{u.num}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.title}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                  <FileCode className="size-2.5" /> {u.filesCount}
                </span>
                <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">{r?.commit ?? '—'}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* RIGHT — summary + handoff to Review (1/3) */}
      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Landed</CardTitle>
            <Badge variant="sage" size="sm">complete</Badge>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <Stat label="Commits" value={`${units.length}`} />
            <Stat label="Files touched" value={`${totalFiles}`} />
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
            <TextSm className="!text-ink-faint">Execution done — the changes are ready for code review.</TextSm>
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
