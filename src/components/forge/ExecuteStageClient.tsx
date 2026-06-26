'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';
import { showToast } from '@/components/ui/toast';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  GitBranch,
  Rocket,
  XCircle,
  Circle,
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { AutomationBar, type AutoMode } from '@/components/forge/AutomationBar';
import { StageAdvance } from '@/components/forge/StageAdvance';
import type { ProjectPhase } from '@/db/enums';
import { inferExecutePhase, type RepoGroup, type ExecutePhase } from '@/build/execute-types';
import { RailNote } from '@/components/patterns/feature-rail';

const EXECUTE_NOTE = `### How execution works

- **Isolated** — each repo runs in its own worktree, never touches your working tree
- **Sequential** — tasks execute one at a time, then reviewed
- **PR** — a pull request is created per repo when complete

### What you control

- **Target branch** — the base branch to fork from and PR into
- **Start** — you decide when to dispatch; agents do the rest`;

/* ── Props ───────────────────────────────────────────────────────────── */

export interface RepoTerminalResult {
  status: 'done' | 'failed';
  durationMs: number | null;
  costUsd: number | null;
  filesChanged: string[];
  worktreeMerged: boolean;
  branch: string | null;
}

export interface ReviewPassView {
  passNo: number;
  status: 'done' | 'failed';
  findings: Array<{ weight: string; category: string; claim: string; evidence: string; file: string; line: number; suggestion: string }>;
  appliedIndices: number[];
}

export interface ExecuteStageClientProps {
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
  repoGroups: RepoGroup[];
  buildPrs: Record<string, { url: string; branch: string; targetBranch: string }>;
  terminalResults?: Record<string, RepoTerminalResult>;
  reviewPasses?: ReviewPassView[];
  reviewRunning?: boolean;
  applyRunning?: boolean;
}

/* ── Types ───────────────────────────────────────────────────────────── */

type RepoJobStatus = 'queued' | 'implementing' | 'reviewing' | 'done' | 'failed';
interface RepoJobState {
  status: RepoJobStatus;
  elapsedMs?: number;
  totalTasks?: number;
  costUsd?: number;
  filesChanged?: string[];
  prUrl?: string | null;
  error?: string;
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function progressPct(status: RepoJobStatus): number {
  if (status === 'implementing') return 40;
  if (status === 'reviewing') return 80;
  if (status === 'done' || status === 'failed') return 100;
  return 0;
}

/* ── Main Component ──────────────────────────────────────────────────── */

export function ExecuteStageClient(props: ExecuteStageClientProps & { initialPhase?: ExecutePhase }) {
  const router = useRouter();
  const readOnly = props.phase === 'learn';
  const derivedPhase = inferExecutePhase(props.repoGroups);
  const [execPhase, setExecPhaseRaw] = useState<ExecutePhase>(props.initialPhase ?? derivedPhase);

  const setExecPhase = (p: ExecutePhase) => {
    setExecPhaseRaw(p);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('phase', p);
      router.push(url.pathname + url.search, { scroll: false });
      fetch(`/api/projects/${props.projectId}/phase`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'execute', phase: p }),
      }).catch(() => {});
    }
  };
  const [branches, setBranches] = useState<Record<string, string>>(
    () => Object.fromEntries(props.repoGroups.map((g) => [g.repoId, g.targetBranch])),
  );
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');

  // Monitor state — seed from terminal results if available
  const [jobs, setJobs] = useState<Record<string, RepoJobState>>(() =>
    Object.fromEntries(
      props.repoGroups.map((g) => {
        const tr = props.terminalResults?.[g.repoId];
        const pr = props.buildPrs[g.repoId];
        if (tr?.status === 'done') {
          return [g.repoId, {
            status: 'done' as const,
            elapsedMs: tr.durationMs ?? undefined,
            costUsd: tr.costUsd ?? undefined,
            filesChanged: tr.filesChanged,
            prUrl: pr?.url ?? null,
          }];
        }
        if (tr?.status === 'failed') {
          return [g.repoId, {
            status: 'failed' as const,
            elapsedMs: tr.durationMs ?? undefined,
            costUsd: tr.costUsd ?? undefined,
            error: 'Execution failed',
          }];
        }
        const allCommitted = g.tasks.every((t) => t.status === 'committed');
        if (allCommitted) return [g.repoId, { status: 'done' as const, prUrl: pr?.url ?? null }];
        const anyFailed = g.tasks.some((t) => t.status === 'failed');
        if (anyFailed) return [g.repoId, { status: 'failed' as const, error: 'Execution failed' }];
        const anyRunning = g.tasks.some((t) => t.status === 'executing');
        return [g.repoId, { status: anyRunning ? ('implementing' as const) : ('queued' as const) }];
      }),
    ),
  );

  const refresh = useCallback(() => { router.refresh(); }, [router]);

  const mma = useMmaDispatch(props.projectId, {
    events: {
      'dispatch.progress': (data: Record<string, unknown>) => {
        if (data.handler !== 'execute-pipeline' || !data.repoId) return;
        const rid = data.repoId as string;
        setJobs((prev) => ({
          ...prev,
          [rid]: {
            status: (data.phase as string) === 'reviewing' ? 'reviewing' : 'implementing',
            elapsedMs: data.elapsedMs as number,
            totalTasks: data.totalTasks as number,
          },
        }));
      },
      'dispatch.failed': (data: Record<string, unknown>) => {
        if (data.handler !== 'execute-pipeline' || !data.repoId) return;
        const rid = data.repoId as string;
        setJobs((prev) => ({ ...prev, [rid]: { status: 'failed', error: (data.error as string) ?? 'Failed' } }));
      },
    },
  });

  useEffect(() => stagePhaseStore.set(execPhase), [execPhase]);
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'configure' || key === 'monitor') setExecPhase(key as ExecutePhase);
      }),
    [],
  );

  async function startExecution() {
    setDispatching(true);
    setDispatchError(null);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/build/start-execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repos: props.repoGroups.map((g) => ({ repoId: g.repoId, targetBranch: branches[g.repoId] })),
        }),
      });
      if (res.status === 202) {
        setDispatching(false);
        setExecPhase('monitor');
        setJobs(Object.fromEntries(props.repoGroups.map((g) => [g.repoId, { status: 'implementing' as const }])));
        void mma.waitFor('execute-pipeline').then(() => refresh()).catch(() => {});
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setDispatchError(json.error ?? `Dispatch failed (HTTP ${res.status})`);
        setDispatching(false);
      }
    } catch {
      setDispatchError('Network error');
      setDispatching(false);
    }
  }

  const allTerminal = props.repoGroups.every((g) => {
    const j = jobs[g.repoId];
    return j?.status === 'done' || j?.status === 'failed';
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="execute-stage">
      <AutomationBar
        mode={auto}
        note={autoNote}
        disabled={readOnly}
        idleHint="Pick target branches and start execution, or let Forge drive."
        runningHint="Forge dispatches the plan, runs every task, creates PRs, then hands off to review."
        onRun={() => {
          setAutoNote('Starting execution…');
          setAuto('running');
          startExecution();
        }}
        onStop={() => {
          setAuto('off');
          setAutoNote('Stopped.');
        }}
      />

      {execPhase === 'configure' ? (
        <ConfigurePhase
          projectName={props.projectName}
          repoGroups={props.repoGroups}
          branches={branches}
          onBranchChange={(repoId, branch) => setBranches((b) => ({ ...b, [repoId]: branch }))}
          dispatching={dispatching}
          dispatchError={dispatchError}
          readOnly={readOnly}
          onStart={startExecution}
        />
      ) : (
        <MonitorPhase
          projectId={props.projectId}
          projectName={props.projectName}
          repoGroups={props.repoGroups}
          jobs={jobs}
          buildPrs={props.buildPrs}
          allTerminal={allTerminal}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

/* ── Configure Phase ─────────────────────────────────────────────────── */

function ConfigurePhase({
  projectName, repoGroups, branches, onBranchChange, dispatching, dispatchError, readOnly, onStart,
}: {
  projectName: string;
  repoGroups: RepoGroup[];
  branches: Record<string, string>;
  onBranchChange: (repoId: string, branch: string) => void;
  dispatching: boolean;
  dispatchError: string | null;
  readOnly: boolean;
  onStart: () => void;
}) {
  const totalTasks = repoGroups.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* LEFT — scrollable task list card */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="size-4 shrink-0 text-accent" />
            <CardTitle>Execution plan</CardTitle>
            <Badge variant="neutral" size="sm">{totalTasks} tasks · {repoGroups.length} repo{repoGroups.length > 1 ? 's' : ''}</Badge>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-tint px-2.5 py-1 text-[11px] font-medium text-accent-deep">
            <Rocket className="size-3" /> MMA execute-plan
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto !py-4">
          {repoGroups.map((g) => (
            <RepoConfigCard key={g.repoId} group={g} targetBranch={branches[g.repoId] ?? g.defaultBranch} onBranchChange={(b) => onBranchChange(g.repoId, b)} />
          ))}
        </CardContent>
      </Card>

      {/* RIGHT — note + card filling rest of column */}
      <aside className="flex min-h-0 flex-col gap-4">
        <RailNote icon={<Rocket />}>{EXECUTE_NOTE}</RailNote>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>{projectName}</CardTitle>
            <Badge variant="neutral" size="sm">plan</Badge>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2.5 !py-4">
            <Stat label="Repos" value={`${repoGroups.length}`} />
            <Stat label="Tasks" value={`${totalTasks}`} />
            <Stat label="PRs" value={`${repoGroups.length}`} />
            <div className="mt-2">
              <Eyebrow className="mb-1.5 !text-ink-faint">Branch plan</Eyebrow>
              {repoGroups.map((g) => (
                <div key={g.repoId} className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                  <GitBranch className="size-2.5" />
                  {g.forgeBranch} → {branches[g.repoId] ?? g.defaultBranch}
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            {dispatchError && <p className="text-sm text-[var(--rose)]">{dispatchError}</p>}
            <Button className="w-full" onClick={onStart} disabled={readOnly || dispatching} loading={dispatching} leftIcon={<Rocket />}>
              {dispatching ? 'Dispatching…' : repoGroups.length > 1 ? `Start execution (${repoGroups.length} repos)` : 'Start execution'}
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

function RepoConfigCard({ group, targetBranch, onBranchChange }: { group: RepoGroup; targetBranch: string; onBranchChange: (b: string) => void }) {
  return (
    <div className="rounded-[var(--r-lg)] border border-line">
      <div className="flex items-center justify-between bg-surface-2 px-4 py-3 first:rounded-t-[var(--r-lg)]">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-4 shrink-0 text-ink-soft" />
          <span className="text-sm font-semibold">{group.repoName}</span>
          <Badge variant="neutral" size="sm">{group.tasks.length} tasks</Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-faint">Target:</span>
          <Select value={targetBranch} onValueChange={onBranchChange}>
            <SelectTrigger aria-label={`Target branch for ${group.repoName}`} className="!h-7 w-auto min-w-[120px] !text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {group.branches.map((b) => (
                <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5 px-4 py-3">
        {group.tasks.map((t, i) => (
          <div key={t.id} className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
            <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-surface-2 font-mono text-[10px] font-semibold text-ink-soft">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.title}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[11px] text-ink-faint">
        <GitBranch className="size-3" />
        {group.forgeBranch} → {targetBranch}
      </div>
    </div>
  );
}

/* ── Monitor Phase ───────────────────────────────────────────────────── */

function MonitorPhase({
  projectId, projectName, repoGroups, jobs, buildPrs, allTerminal, readOnly,
}: {
  projectId: string;
  projectName: string;
  repoGroups: RepoGroup[];
  jobs: Record<string, RepoJobState>;
  buildPrs: Record<string, { url: string; branch: string; targetBranch: string }>;
  allTerminal: boolean;
  readOnly: boolean;
}) {
  const doneCount = repoGroups.filter((g) => jobs[g.repoId]?.status === 'done').length;
  const failedCount = repoGroups.filter((g) => jobs[g.repoId]?.status === 'failed').length;
  const totalTasks = repoGroups.reduce((n, g) => n + g.tasks.length, 0);
  const maxElapsed = Math.max(...repoGroups.map((g) => jobs[g.repoId]?.elapsedMs ?? 0));
  const anyRunning = repoGroups.some((g) => { const s = jobs[g.repoId]?.status; return s === 'implementing' || s === 'reviewing'; });

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* LEFT — repo job cards inside a Card with scrollable content */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            {allTerminal
              ? <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
              : <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
            }
            <CardTitle>{allTerminal ? 'Execution complete' : 'Executing…'}</CardTitle>
            <Badge variant={allTerminal ? 'sage' : 'accent'} size="sm">
              {allTerminal ? `${doneCount} done` : `${doneCount}/${repoGroups.length}`}
            </Badge>
          </div>
          {maxElapsed > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-faint font-mono">
              <Clock className="size-3" /> {formatElapsed(maxElapsed)}
            </span>
          )}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4" role="status" aria-live="polite">
          {repoGroups.map((g) => (
            <RepoJobCard key={g.repoId} group={g} job={jobs[g.repoId] ?? { status: 'queued' }} pr={buildPrs[g.repoId]} />
          ))}
        </CardContent>
      </Card>

      {/* RIGHT — note + summary card filling column */}
      <aside className="flex min-h-0 flex-col gap-4">
        {anyRunning && (
          <div className="flex items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent">
              <Loader2 className="size-5 animate-spin" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">Executing plan</h3>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                <li className="text-xs leading-relaxed text-ink-soft marker:text-accent">Tasks run sequentially in an isolated worktree</li>
                <li className="text-xs leading-relaxed text-ink-soft marker:text-accent">Reviewer verifies the implementation after</li>
                <li className="text-xs leading-relaxed text-ink-soft marker:text-accent">PR created automatically when complete</li>
              </ul>
            </div>
          </div>
        )}
        {allTerminal && (
          <div className="flex items-start gap-3 rounded-[var(--r-lg)] border border-[var(--sage-tint)] bg-[var(--sage-tint)]/40 px-4 py-4">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-[var(--sage-tint)] text-[var(--sage)]">
              <CheckCircle2 className="size-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">Execution complete</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">All repos have finished. Review the results and continue to code review.</p>
            </div>
          </div>
        )}
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Execution</CardTitle>
            <Badge variant={allTerminal ? 'sage' : 'accent'} size="sm">{allTerminal ? 'complete' : 'running'}</Badge>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2.5 !py-4">
            <Stat label="Repos" value={`${doneCount} / ${repoGroups.length} done`} />
            {failedCount > 0 && <Stat label="Failed" value={`${failedCount}`} />}
            <Stat label="Tasks" value={`${totalTasks}`} />
            {(() => {
              const totalFiles = Object.values(jobs).reduce((n, j) => n + (j.filesChanged?.length ?? 0), 0);
              const totalCost = Object.values(jobs).reduce((n, j) => n + (j.costUsd ?? 0), 0);
              const totalDuration = Math.max(...Object.values(jobs).map((j) => j.elapsedMs ?? 0));
              return (
                <>
                  {totalFiles > 0 && <Stat label="Files changed" value={`${totalFiles}`} />}
                  {totalCost > 0 && <Stat label="Cost" value={`$${totalCost.toFixed(2)}`} />}
                  {totalDuration > 0 && <Stat label="Duration" value={formatElapsed(totalDuration)} />}
                </>
              );
            })()}
            {Object.keys(buildPrs).length > 0 && (
              <div className="mt-2">
                <Eyebrow className="mb-1.5 !text-ink-faint">Pull requests</Eyebrow>
                {Object.entries(buildPrs).map(([rid, pr]) => (
                  <a key={rid} href={pr.url} target="_blank" rel="noopener noreferrer" className="block text-xs text-accent underline">
                    {pr.branch} → {pr.targetBranch}
                  </a>
                ))}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <StageAdvance
              href={`/projects/${projectId}/review`}
              label="Continue to Review"
              disabled={!allTerminal || readOnly}
              projectId={projectId}
              from="execute"
              testId="execute-continue-link"
            />
            {!allTerminal && <TextSm className="text-center !text-ink-faint">Waiting for all repos to complete</TextSm>}
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

function RepoJobCard({ group, job, pr }: { group: RepoGroup; job: RepoJobState; pr?: { url: string; branch: string; targetBranch: string } }) {
  const isDone = job.status === 'done';
  const isFailed = job.status === 'failed';
  const isRunning = job.status === 'implementing' || job.status === 'reviewing';
  const isReviewing = job.status === 'reviewing';

  const borderColor = isDone ? 'border-[var(--sage-tint)]' : isFailed ? 'border-[var(--rose-tint)]' : isRunning ? 'border-accent-tint' : 'border-line';

  return (
    <div className={cn('rounded-[var(--r-lg)] border', borderColor)}>
      <div className={cn('flex items-center justify-between px-4 py-3 border-b', isDone ? 'border-b-[var(--sage-tint)]' : isFailed ? 'border-b-[var(--rose-tint)]' : isRunning ? 'border-b-accent-tint' : 'border-b-line')}>
        <div className="flex min-w-0 items-center gap-2">
          {isDone ? <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" /> : isFailed ? <XCircle className="size-4 shrink-0 text-[var(--rose)]" /> : isRunning ? <Loader2 className="size-4 shrink-0 animate-spin text-accent" /> : <Circle className="size-4 shrink-0 text-line-strong" />}
          <span className="font-semibold text-sm">{group.repoName}</span>
          <Badge variant={isDone ? 'sage' : isFailed ? 'rose' : isRunning ? 'accent' : 'neutral'} size="sm">{job.status}</Badge>
        </div>
        {(isDone || isFailed) && job.elapsedMs != null && (
          <span className="text-xs text-ink-faint font-mono">{formatElapsed(job.elapsedMs)}{job.costUsd != null ? ` · $${job.costUsd.toFixed(2)}` : ''}</span>
        )}
        {isRunning && job.elapsedMs != null && (
          <span className="text-xs text-ink-faint font-mono">{formatElapsed(job.elapsedMs)}</span>
        )}
      </div>
      <div className="space-y-3 px-4 py-3">
        {/* Progress bar */}
        <div className="h-1.5 overflow-hidden rounded-full bg-[#f0ede8]">
          <div
            className={cn('h-full rounded-full transition-all duration-700', isDone ? 'bg-[var(--sage)]' : isFailed ? 'bg-[var(--rose)]' : 'bg-accent')}
            style={{ width: `${progressPct(job.status)}%` }}
          />
        </div>

        {/* Phase pills (running) */}
        {isRunning && (
          <div className="flex items-center gap-1.5">
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', isReviewing ? 'bg-[var(--sage-tint)] text-[var(--sage-deep)]' : 'bg-accent-tint text-accent-deep')}>
              {isReviewing ? <CheckCircle2 className="size-2.5" /> : <Loader2 className="size-2.5 animate-spin" />}
              {isReviewing ? 'Implemented' : 'Implementing'}
            </span>
            <ArrowRight className="size-2.5 text-line-strong" />
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', isReviewing ? 'bg-accent-tint text-accent-deep' : 'text-ink-faint')}>
              {isReviewing ? <Loader2 className="size-2.5 animate-spin" /> : <Circle className="size-2.5" />}
              Reviewing
            </span>
            <ArrowRight className="size-2.5 text-line-strong" />
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-ink-faint">
              <Circle className="size-2.5" /> PR
            </span>
          </div>
        )}

        {/* Done phase pills */}
        {isDone && (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--sage-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--sage-deep)]">✓ Implemented</span>
            <ArrowRight className="size-2.5 text-line-strong" />
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--sage-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--sage-deep)]">✓ Reviewed</span>
            <ArrowRight className="size-2.5 text-line-strong" />
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--sage-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--sage-deep)]">✓ PR</span>
          </div>
        )}

        {/* Done summary */}
        {isDone && (
          <div className="flex flex-wrap gap-3 text-xs text-ink-soft">
            <span>{group.tasks.length} tasks committed</span>
            {job.filesChanged && job.filesChanged.length > 0 && (
              <><span>·</span><span>{job.filesChanged.length} files changed</span></>
            )}
            {job.costUsd != null && job.costUsd > 0 && (
              <><span>·</span><span>${job.costUsd.toFixed(2)}</span></>
            )}
            {job.elapsedMs != null && job.elapsedMs > 0 && (
              <><span>·</span><span>{formatElapsed(job.elapsedMs)}</span></>
            )}
            {pr && (
              <><span>·</span><a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">PR: {pr.branch} → {pr.targetBranch}</a></>
            )}
          </div>
        )}

        {/* Failed error */}
        {isFailed && job.error && (
          <p className="text-xs text-[var(--rose)]" role="alert">{job.error}</p>
        )}

        {/* Info line */}
        {isRunning && (
          <div className="text-[11px] text-ink-faint">{job.totalTasks ?? group.tasks.length} tasks · target: {group.targetBranch}</div>
        )}
      </div>
    </div>
  );
}

/* ── Shared ───────────────────────────────────────────────────────────── */

/* ── Review Phase (inline within Execute) ─────────────────────────── */


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2 last:border-0">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
