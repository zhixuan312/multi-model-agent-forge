'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  Plus,
  X,
  ArrowRight,
  RefreshCw,
  Lightbulb,
  ScanSearch,
  Globe,
  History,
  FolderGit2,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { ProseBlock } from '@/components/patterns/prose-block';
import { ConversationComposer } from '@/components/patterns/conversation';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell, StageFullWidth, type StageShellItem } from '@/components/patterns/stage-shell';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { AutomationBar } from '@/components/forge/AutomationBar';
import {
  Button,
  Badge,
  Banner,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Micro,
  Eyebrow,
  Title,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '@/components/ui';
import {
  useProjectEvents,
  explorationKeys,
  type RailTask,
  type ArtifactCacheEntry,
} from '@/hooks/useProjectEvents';
import { PROMPT_FLOORS } from '@/exploration/schemas';
import { cn } from '@/lib/cn';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';
import { showToast } from '@/components/ui/toast';

/** Per-route prompt floor — pulled from the client-safe schema constants. */
const promptFloor = (kind: 'investigate' | 'research' | 'journal'): number => PROMPT_FLOORS[kind];

/**
 * `ExploreStageClient` (Spec 5) — the exploration stage island. Three phases:
 * Brief (brain-dump + task proposal) → Discover (task detail + findings) →
 * Synthesize (file-based exploration brief). SSE patches the TanStack cache
 * for live task status updates.
 */

interface ExploreStageClientProps {
  projectId: string;
  projectName: string;
  initialBrief: string;
  initialTasks: RailTask[];
  initialArtifact: { id: string; version: number; bodyMd: string } | null;
  repoOptions: { id: string; name: string }[];
  voiceEnabled: boolean;
  canMutate?: boolean;
  lockedReason?: string;
  pendingHandlers?: string[];
  initialPhase?: 'brief' | 'discover' | 'synthesize';
}

export function ExploreStageClient(props: ExploreStageClientProps) {
  const qc = useQueryClient();
  useProjectEvents(props.projectId);
  const locked = props.canMutate === false;

  // Seed the live caches from RSC first paint.
  if (qc.getQueryData(explorationKeys.tasks(props.projectId)) === undefined) {
    qc.setQueryData(explorationKeys.tasks(props.projectId), props.initialTasks);
  }
  if (props.initialArtifact && qc.getQueryData(explorationKeys.artifact(props.projectId)) === undefined) {
    qc.setQueryData(explorationKeys.artifact(props.projectId), props.initialArtifact);
  }

  const { data: tasks = props.initialTasks } = useQuery<RailTask[]>({
    queryKey: explorationKeys.tasks(props.projectId),
    queryFn: async () =>
      (await fetch(`/api/projects/${props.projectId}/explore/tasks`).then((r) => (r.ok ? r.json() : props.initialTasks))) as RailTask[],
    initialData: props.initialTasks,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Keep polling while a task is still working OR has flipped to `done` but its
      // result envelope (outputMd) hasn't materialized yet — the batch status and the
      // persisted result are written in separate ticks, so a poll can observe `done`
      // before the output is joinable. Stopping there would strand the client on an
      // empty-output snapshot until a manual refresh. Failed tasks are terminal.
      const pending = data?.some((t) =>
        t.status === 'running' ||
        (t.batchStatus != null && t.batchStatus !== 'done' && t.batchStatus !== 'failed') ||
        (t.batchStatus === 'done' && !t.outputMd),
      );
      return pending ? 3000 : false;
    },
  });
  const { data: artifact } = useQuery<ArtifactCacheEntry | undefined>({
    queryKey: explorationKeys.artifact(props.projectId),
    queryFn: async () => {
      const r = await fetch(`/api/projects/${props.projectId}/explore/artifact`);
      return r.ok ? ((await r.json()) as ArtifactCacheEntry) : props.initialArtifact ?? undefined;
    },
    initialData: props.initialArtifact ?? undefined,
    enabled: false,
  });

  const [brief, setBrief] = useState(props.initialBrief);
  const [viewOverrideRaw, setViewOverrideRaw] = useState<'brief' | 'discover' | 'synthesize' | null>(props.initialPhase ?? null);
  const setViewOverride = (v: 'brief' | 'discover' | 'synthesize') => {
    setViewOverrideRaw(v);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('phase', v);
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  };
  const viewOverride = viewOverrideRaw;

  const drafts = tasks.filter((t) => t.status === 'draft');

  function refreshTasks(): void {
    void qc.invalidateQueries({ queryKey: explorationKeys.tasks(props.projectId) });
  }

  async function refreshArtifact() {
    const r = await fetch(`/api/projects/${props.projectId}/explore/artifact`);
    if (r.ok) {
      const a = (await r.json()) as ArtifactCacheEntry;
      qc.setQueryData(explorationKeys.artifact(props.projectId), a);
    }
  }

  const mma = useMmaDispatch(props.projectId, {
    onDone: {
      'explore-propose': () => refreshTasks(),
      'explore-synthesize': () => refreshArtifact(),
    },
    events: {
      'synthesis.updated': () => refreshArtifact(),
    },
  });

  const proposing = mma.busyHandlers.has('explore-propose');
  const synthesizing = mma.busyHandlers.has('explore-synthesize');
  const { error } = mma;

  // Exploration sub-phase transitions go through the unified engine as
  // `advance_phase` (the resolver picks the correct next phase from state).
  async function advancePhase(_targetPhase: string): Promise<boolean> {
    try {
      await mma.transition('advance_phase');
      return true;
    } catch { return false; }
  }

  async function analyze(): Promise<void> {
    // Save the brief then dispatch the discovery-task proposal — both through the
    // unified engine (set_brief is a content action; propose is the transition).
    try {
      await mma.transition('set_brief', { text: brief });
      await mma.transition('propose_discover_tasks', undefined, 'explore-propose');
    } catch {
      showToast({ type: 'error', message: 'Couldn’t propose discovery tasks — try again.' });
    }
  }

  async function run(): Promise<void> {
    try {
      await mma.transition('run_discover_tasks');
      refreshTasks();
      setTimeout(refreshTasks, 2600);
    } catch {
      showToast({ type: 'error', message: 'Couldn’t run discovery — try again.' });
    }
  }

  async function resynthesize(): Promise<void> {
    try {
      await mma.transition('dispatch_synthesize', undefined, 'explore-synthesize');
    } catch {
      showToast({ type: 'error', message: 'Couldn’t synthesize — try again.' });
    }
  }

  const bodyMd = artifact?.bodyMd ?? props.initialArtifact?.bodyMd ?? null;
  const version = artifact?.version ?? props.initialArtifact?.version ?? null;
  const dispatched = tasks.filter((t) => t.status !== 'draft').length;
  const recorded = tasks.filter((t) => t.status === 'recorded').length;
  const allDone = dispatched > 0 && recorded === dispatched;

  // The centre stage is a single area that advances through the flow.
  const dataPhase: 'idle' | 'fanout' | 'run' | 'synthesis' =
    drafts.length > 0 ? 'fanout' : bodyMd ? 'synthesis' : dispatched > 0 ? 'run' : 'idle';

  // Allow the user to navigate back to a previous sub-phase via the stepper.
  // Brief = editable proposal (add/edit tasks). Fan-out = agent execution rail.
  const phase: 'idle' | 'fanout' | 'run' | 'synthesis' = (() => {
    if (!viewOverride) return dataPhase;
    if (viewOverride === 'brief') return dataPhase === 'idle' ? 'idle' : 'fanout';
    if (viewOverride === 'discover') return dispatched > 0 ? 'run' : 'fanout';
    if (viewOverride === 'synthesize') return 'synthesis';
    return dataPhase;
  })();

  // Publish the viewing sub-phase to the stepper (does NOT persist to DB — that's
  // done explicitly in "Continue to X" handlers via advancePhaseAndTransition).
  useEffect(() => {
    const sub = viewOverride
      ? viewOverride
      : phase === 'synthesis' ? 'synthesize' : phase === 'idle' ? 'brief' : phase === 'fanout' ? 'brief' : 'discover';
    stagePhaseStore.set(sub);
  }, [phase, viewOverride]);

  const synthFired = useRef(false);
  useEffect(() => {
    if (phase === 'synthesis' && !bodyMd && !synthesizing && !locked && !synthFired.current) {
      synthFired.current = true;
      resynthesize();
    }
  }, [phase, bodyMd, synthesizing, locked]);

  useEffect(() => {
    return stagePhaseStore.onNavigate((key) => {
      setViewOverride(key as 'brief' | 'discover' | 'synthesize');
    });
  }, []);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(tasks.find((t) => t.status !== 'draft')?.id ?? tasks[0]?.id ?? null);
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [selectedTaskId, tasks]);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const KIND_ORDER: Record<string, number> = { investigate: 0, research: 1, journal: 2 };
  const taskItems: StageShellItem[] = [...tasks]
    .filter((t) => t.status !== 'draft')
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))
    .map((t) => {
      let status: string;
      let statusVariant: StageShellItem['statusVariant'];
      if (t.batchStatus === 'failed' && !t.outputMd) { status = 'failed'; statusVariant = 'rose'; }
      else if (t.batchStatus === 'failed' && t.outputMd) { status = 'recorded'; statusVariant = 'amber'; }
      else if (t.status === 'recorded' || t.batchStatus === 'done') { status = 'recorded'; statusVariant = 'sage'; }
      else { status = 'running'; statusVariant = 'amber'; }
      const LABEL: Record<string, string> = { investigate: 'Investigate', research: 'Research', journal: 'Journal recall' };
      return { id: t.id, label: LABEL[t.kind] ?? t.kind, description: t.prompt, status, statusVariant };
    });

  const noteEl = <ExplorationNote phase={phase} />;
  const hasAnalyzed = dispatched > 0 || drafts.length > 0;
  const [briefView, setBriefView] = useState<'input' | 'tasks'>(hasAnalyzed ? 'tasks' : 'input');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <AutomationBar
        mode="off"
        note=""
        disabled
        idleHint="Automation unlocks once the spec is set — Design stages are hand-authored."
      />

      {error ? (
        <div className="shrink-0 rounded-[var(--r-md)] border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-4 py-2 text-sm text-[var(--rose)]" role="alert">
          {error}
        </div>
      ) : null}

      {/* Brief phase: brain-dump left, stats + advance right */}
      {(phase === 'idle' || phase === 'fanout') ? (
        <StageFullWidth
          note={noteEl}
          sidebar={
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardHeader>
                <CardTitle>Exploration</CardTitle>
                {hasAnalyzed ? (
                  <Badge variant="neutral" size="sm">{tasks.length} tasks</Badge>
                ) : null}
              </CardHeader>
              <CardContent className="min-h-0 flex-1 !py-4">
                <div className="space-y-0">
                  <StatRow label="Investigations" value={String(tasks.filter((t) => t.kind === 'investigate').length)} />
                  <StatRow label="Research" value={String(tasks.filter((t) => t.kind === 'research').length)} />
                  <StatRow label="Journal recalls" value={String(tasks.filter((t) => t.kind === 'journal').length)} />
                </div>
              </CardContent>
              <CardFooter className="flex-col !items-stretch gap-2">
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={async () => {
                    if (!hasAnalyzed) { analyze(); }
                    else if (drafts.length > 0) { run(); }
                    // Only move the view if the server actually advanced the phase —
                    // a rejected transition must NOT navigate.
                    if (await advancePhase('discover')) setViewOverride('discover');
                  }}
                  disabled={locked || proposing || tasks.length === 0}
                  loading={proposing}
                  rightIcon={<ArrowRight />}
                >
                  {proposing ? 'Analyzing…' : 'Continue to Discover'}
                </Button>
              </CardFooter>
            </Card>
          }
        >
          {briefView === 'input' ? (
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardHeader>
                <CardTitle>Brain-dump</CardTitle>
                {hasAnalyzed ? (
                  <ViewToggle active="input" onSwitch={(v) => setBriefView(v as 'input' | 'tasks')} labels={['Brain-dump', 'Tasks']} values={['input', 'tasks']} />
                ) : (
                  <Micro className="!text-ink-faint">Text · voice · files</Micro>
                )}
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col !py-4">
                <ConversationComposer
                  value={brief}
                  onChange={locked ? () => {} : setBrief}
                  onSend={locked ? () => {} : () => { analyze(); setBriefView('tasks'); }}
                  voice={props.voiceEnabled && !locked}
                  disabled={locked || proposing}
                  placeholder="Tell Forge everything you know…"
                  submitLabel={hasAnalyzed ? 'Re-analyze' : 'Analyze sources'}
                  rows={0}
                  className="flex min-h-0 flex-1 flex-col gap-3 border-0 px-0 py-0"
                />
              </CardContent>
            </Card>
          ) : proposing && tasks.length === 0 ? (
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardHeader>
                <CardTitle>Exploration tasks</CardTitle>
                <ViewToggle active="tasks" onSwitch={(v) => setBriefView(v as 'input' | 'tasks')} labels={['Brain-dump', 'Tasks']} values={['input', 'tasks']} />
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center !py-5">
                <Loader2 className="size-5 animate-spin text-accent" />
                <p className="text-sm text-ink-faint">Analyzing sources to propose exploration tasks…</p>
              </CardContent>
            </Card>
          ) : (
            <FanOutCard
              className="min-h-0 flex-1"
              projectId={props.projectId}
              drafts={drafts}
              allTasks={tasks}
              repoOptions={props.repoOptions}
              onChanged={refreshTasks}
              onRun={run}
              canRun={drafts.length > 0 && !proposing && !locked}
              disabled={proposing || locked}
              headerAction={
                <ViewToggle active="tasks" onSwitch={(v) => setBriefView(v as 'input' | 'tasks')} labels={['Brain-dump', 'Tasks']} values={['input', 'tasks']} />
              }
            />
          )}
        </StageFullWidth>

      /* Discover phase: task list in rail, selected task detail in main */
      ) : phase === 'run' ? (
        <StageShell
          note={noteEl}
          items={taskItems}
          activeId={selectedTaskId}
          onSelect={setSelectedTaskId}
          listTitle="Tasks"
          listProgress={`${recorded}/${dispatched}`}
          progressPct={dispatched ? (recorded / dispatched) * 100 : 0}
          footer={
            <Button
              variant="primary"
              className="w-full"
              onClick={async () => { if (await advancePhase('synthesize')) setViewOverride('synthesize'); }}
              disabled={!allDone || locked || synthesizing}
              loading={synthesizing}
              rightIcon={<ArrowRight />}
            >
              {synthesizing ? 'Synthesizing…' : 'Continue to Synthesize'}
            </Button>
          }
        >
          <CardHeader>
            <CardTitle>{selectedTask ? (taskItems.find((t) => t.id === selectedTaskId)?.label ?? '') : 'Select a task'}</CardTitle>
          </CardHeader>
          {selectedTask ? (
            <div className="border-b border-line px-5 py-3">
              <Eyebrow className="mb-1 !text-ink-faint">Prompt</Eyebrow>
              {/* Cap the prompt so a very long one scrolls in place instead of
                  growing the pane and squeezing the output area below it. */}
              <p className="max-h-40 overflow-y-auto pr-1 text-sm leading-relaxed text-ink">{selectedTask.prompt}</p>
            </div>
          ) : null}
          <CardContent className="min-h-0 flex-1 overflow-y-auto !py-4">
            {!selectedTask ? (
              <div className="grid h-full place-items-center">
                <p className="text-sm text-ink-faint">Select a task from the list to view its output.</p>
              </div>
            ) : selectedTask.batchStatus === 'failed' && !selectedTask.outputMd ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <p className="text-sm font-medium text-[var(--rose)]">Task failed</p>
                <p className="text-xs text-ink-soft">{selectedTask.error?.message ?? 'Unknown error.'}</p>
              </div>
            ) : selectedTask.status !== 'recorded' && selectedTask.batchStatus !== 'done' && selectedTask.batchStatus !== 'failed' ? (
              <div className="grid h-full place-items-center">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="size-6 animate-spin text-accent" />
                  <p className="text-sm text-ink-faint">{selectedTask.headline ?? 'Running…'}</p>
                </div>
              </div>
            ) : selectedTask.outputMd ? (
              <>
                {selectedTask.error ? (
                  <div className="mb-3 rounded-[var(--r-md)] border border-amber bg-amber-tint/40 px-3 py-2 text-xs text-amber-deep">
                    {selectedTask.error.message}
                  </div>
                ) : null}
                <Eyebrow className="mb-2 !text-ink-faint">Findings</Eyebrow>
                <ProseBlock variant="document">{selectedTask.outputMd}</ProseBlock>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-ink-faint">No output available.</p>
            )}
          </CardContent>
        </StageShell>

      /* Synthesize phase: synthesis doc left, stats + advance right */
      ) : (
        <StageFullWidth
          note={noteEl}
          sidebar={
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardHeader>
                <CardTitle>Synthesis</CardTitle>
                <Button size="sm" variant="primary" onClick={locked ? () => {} : resynthesize} disabled={locked || synthesizing} loading={synthesizing} leftIcon={bodyMd ? <RefreshCw /> : <Sparkles />}>
                  {synthesizing ? 'Synthesizing…' : bodyMd ? 'Re-synthesize' : 'Synthesize'}
                </Button>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 !py-4">
                <div className="space-y-0">
                  <StatRow label="Tasks completed" value={`${recorded}/${dispatched}`} />
                  <StatRow label="Brief" value={bodyMd ? `v${version}` : 'Not yet'} />
                </div>
              </CardContent>
              <CardFooter className="flex-col !items-stretch gap-2">
                <StageAdvance
                  href={`/projects/${props.projectId}/spec`}
                  label="Continue to Spec"
                  disabled={!bodyMd || locked}
                  projectId={props.projectId}
                  from="exploration"
                />
              </CardFooter>
            </Card>
          }
        >
          <SummaryPane
            className="min-h-0 flex-1"
            bodyMd={bodyMd as string}
            version={version}
          />
        </StageFullWidth>
      )}
    </div>
  );
}

function ViewToggle({ active, onSwitch, labels, values }: { active: string; onSwitch: (v: string) => void; labels: string[]; values: string[] }) {
  return (
    <div className="flex items-center rounded-[var(--r)] border border-line bg-surface-2 p-0.5">
      {values.map((v, i) => (
        <button
          key={v}
          type="button"
          onClick={() => onSwitch(v)}
          className={cn(
            'rounded-[6px] px-3 py-1 text-xs font-medium transition-colors',
            active === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink',
          )}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  );
}


/** Standing guidance — the accent-tint note every page's rail carries. */
const PHASE_NOTES: Record<string, string> = {
  brief: `### What to do here

- Write everything you know about the problem in the left panel
- Include goals, constraints, relevant repos, and any prior context
- Press **Analyze sources** to generate exploration tasks
- Switch to the **Tasks** tab to review what Forge proposed

### Next step

- Press **Continue to Discover** to run the tasks and see results`,

  discover: `### What you're seeing

- Each task in the list ran an agent against a repo, the web, or the team journal
- Select a task to read its **prompt** (what was asked) and **findings** (what was found)
- Green = recorded, amber = running, red = failed

### Next step

- Review the findings, then press **Continue to Synthesize** to build the brief`,

  synthesize: `### What you're seeing

- The left panel shows the synthesized exploration brief
- This brief consolidates all task findings into one document organized by theme
- The file is stored at \`exploration.md\` — you can edit it in any text editor

### Next step

- Review the brief, press **Re-synthesize** if needed
- Press **Continue to Spec** to carry this brief into the specification stage`,
};

function ExplorationNote({ phase }: { phase: string }) {
  const key = phase === 'idle' ? 'brief' : phase === 'fanout' ? 'brief' : phase === 'run' ? 'discover' : 'synthesize';
  return <RailNote icon={<Lightbulb />}>{PHASE_NOTES[key]}</RailNote>;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 last:border-b-0">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

/* ── Fan-out editor ───────────────────────────────────────────────────────── */

interface GroupDef {
  kind: 'investigate' | 'research' | 'journal';
  label: string;
  desc: string;
  Icon: LucideIcon;
  tint: 'accent' | 'steel' | 'amber';
  /** Source label shown on the card top for non-repo kinds. */
  source: string | null;
}

const GROUPS: GroupDef[] = [
  {
    kind: 'investigate',
    label: 'Investigation',
    desc: 'Read the codebase — one repo per task.',
    Icon: ScanSearch,
    tint: 'accent',
    source: null,
  },
  {
    kind: 'research',
    label: 'Research',
    desc: 'External knowledge — web search & attached papers.',
    Icon: Globe,
    tint: 'steel',
    source: 'Web & papers',
  },
  {
    kind: 'journal',
    label: 'Journal recall',
    desc: 'What the team has learned before.',
    Icon: History,
    tint: 'amber',
    source: 'Team journal',
  },
];

const KIND_TINT: Record<GroupDef['tint'], string> = {
  accent: 'bg-accent-tint text-accent',
  steel: 'bg-[var(--frost)] text-[var(--steel)]',
  amber: 'bg-amber-tint text-[var(--amber)]',
};

function FanOutCard(props: {
  className?: string;
  projectId: string;
  drafts: RailTask[];
  allTasks: RailTask[];
  repoOptions: { id: string; name: string }[];
  onChanged: () => void;
  onRun: () => void;
  canRun: boolean;
  disabled?: boolean;
  headerAction?: React.ReactNode;
}) {
  const [adding, setAdding] = useState<string | null>(null);

  async function patch(taskId: string, body: unknown): Promise<void> {
    await fetch(`/api/projects/${props.projectId}/explore/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    props.onChanged();
  }
  async function remove(taskId: string): Promise<void> {
    await fetch(`/api/projects/${props.projectId}/explore/tasks/${taskId}`, { method: 'DELETE' });
    props.onChanged();
  }
  async function add(kind: string, prompt: string, targetRepoId: string | null): Promise<void> {
    await fetch(`/api/projects/${props.projectId}/explore/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, prompt, targetRepoId }),
    });
    setAdding(null);
    props.onChanged();
  }

  // Run is disabled while any draft prompt is sub-floor (Short-prompt rule).
  const anySubFloor = props.drafts.some((t) => t.prompt.trim().length < promptFloor(t.kind as never));
  const repoName = (id: string | null): string =>
    props.repoOptions.find((r) => r.id === id)?.name ?? 'unassigned';
  const recorded = props.allTasks.filter((t) => t.status !== 'draft');
  const totalCount = props.drafts.length + recorded.length;

  return (
    <Card className={cn('flex flex-col', props.className)} aria-label="Proposed fan-out">
      <CardHeader>
        <CardTitle>{recorded.length > 0 && props.drafts.length === 0 ? 'Exploration tasks' : 'Proposed fan-out'}</CardTitle>
        {props.headerAction ?? null}
      </CardHeader>

      <CardContent className="min-h-0 flex-1 space-y-7 overflow-y-auto !py-5">
        {GROUPS.map((g) => {
            const draftItems = props.drafts.filter((t) => t.kind === g.kind);
            const recordedItems = recorded.filter((t) => t.kind === g.kind);
            const items = [...recordedItems, ...draftItems];
            const Icon = g.Icon;
            const tint = KIND_TINT[g.tint];
            return (
              <div key={g.kind} className="space-y-3">
                {/* Group header — kind icon · serif title · mma skill · count · description */}
                <div className="flex items-start gap-3">
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-[var(--r-md)]', tint)}>
                    <Icon className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Title as="h3" className="!text-base !leading-none">
                        {g.label}
                      </Title>
                      <Badge variant="neutral" size="sm">
                        {items.length} {items.length === 1 ? 'task' : 'tasks'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">{g.desc}</p>
                  </div>
                </div>

                {/* Task cards + a dashed "Add" card completing the grid */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((t) => {
                    const isDraft = t.status === 'draft';
                    const subFloor = isDraft && t.prompt.trim().length < promptFloor(t.kind as never);
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          'group/task flex flex-col rounded-[var(--r-md)] border bg-surface p-3.5 shadow-sm transition-colors',
                          subFloor ? 'border-[var(--rose)]/60' : 'border-line',
                          isDraft && 'hover:border-line-strong',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('grid size-7 shrink-0 place-items-center rounded-[7px]', tint)}>
                            <Icon className="size-3.5" />
                          </span>
                          {g.kind === 'investigate' ? (
                            <span
                              title={repoName(t.targetRepoId)}
                              className="inline-flex min-w-0 items-center gap-1.5 rounded-[6px] border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink"
                            >
                              <FolderGit2 className="size-3 shrink-0 text-ink-faint" />
                              <span className="truncate">{repoName(t.targetRepoId)}</span>
                            </span>
                          ) : (
                            <span className="truncate text-xs font-semibold text-ink">{g.source}</span>
                          )}
                          <span className="flex-1" />
                          {!isDraft ? (
                            <Badge variant="sage" size="sm">done</Badge>
                          ) : (
                            <button
                              type="button"
                              aria-label="Remove task"
                              onClick={() => remove(t.id)}
                              className="-mr-1 shrink-0 rounded p-1 text-ink-faint opacity-0 transition-all hover:bg-surface-2 hover:text-[var(--rose)] focus-visible:opacity-100 group-hover/task:opacity-100"
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </div>

                        {isDraft ? (
                          <>
                            <Textarea
                              aria-label={`${g.label} prompt`}
                              defaultValue={t.prompt}
                              rows={1}
                              onBlur={(e) => patch(t.id, { prompt: e.target.value })}
                              className={cn(
                                'field-sizing-content mt-2.5 !min-h-0 !resize-none !border-0 !bg-transparent !px-0 !py-0 !text-sm !leading-relaxed !shadow-none focus-visible:!ring-0',
                                subFloor && '!text-[var(--rose)]',
                              )}
                            />
                            {subFloor ? (
                              <span className="mt-1 text-[11px] text-[var(--rose)]">
                                Needs ≥ {promptFloor(t.kind as never)} characters
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <p className="mt-2.5 text-sm leading-relaxed text-ink">{t.prompt}</p>
                        )}
                      </div>
                    );
                  })}

                  {adding === g.kind ? (
                    <div className="sm:col-span-2 xl:col-span-3">
                      <AddTaskForm
                        group={g}
                        repoOptions={props.repoOptions}
                        onCancel={() => setAdding(null)}
                        onAdd={(prompt, repoId) => add(g.kind, prompt, repoId)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAdding(g.kind)}
                      disabled={props.disabled}
                      className="flex min-h-[7rem] flex-col items-center justify-center gap-1.5 rounded-[var(--r-md)] border border-dashed border-line-strong text-sm font-medium text-ink-soft transition-colors hover:border-accent hover:bg-accent-tint/30 hover:text-accent disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Plus className="size-4" /> Add {g.label.toLowerCase()}
                    </button>
                  )}
                </div>
              </div>
            );
        })}
      </CardContent>
    </Card>
  );
}

const NEW_PLACEHOLDER: Record<GroupDef['kind'], string> = {
  investigate: 'What should the agent look for in this repository?',
  research: 'What external question should the agent research?',
  journal: 'What past decision or learning should it recall?',
};

function AddTaskForm(props: {
  group: GroupDef;
  repoOptions: { id: string; name: string }[];
  onCancel: () => void;
  onAdd: (prompt: string, repoId: string | null) => void;
}) {
  const { group } = props;
  const Icon = group.Icon;
  const isRepo = group.kind === 'investigate';
  const noun = group.label.toLowerCase();
  const [prompt, setPrompt] = useState('');
  const [repoId, setRepoId] = useState('');
  const floor = promptFloor(group.kind);
  const tooShort = prompt.trim().length < floor;
  const needsRepo = isRepo && !repoId;
  const valid = !tooShort && !needsRepo;
  const hint = tooShort ? `Needs ≥ ${floor} characters` : needsRepo ? 'Pick a repository' : 'Ready to add';

  return (
    <div className="overflow-hidden rounded-[var(--r-md)] border border-accent/45 bg-surface shadow-sm ring-1 ring-accent/10">
      {/* Form header — kind identity + (repo selector | source) */}
      <div className="flex items-center gap-2.5 border-b border-line bg-accent-tint/25 px-4 py-3">
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-[7px]', KIND_TINT[group.tint])}>
          <Icon className="size-3.5" />
        </span>
        <span className="text-sm font-semibold text-ink">New {noun}</span>
        <span className="flex-1" />
        {isRepo ? (
          <Select value={repoId || undefined} onValueChange={setRepoId}>
            <SelectTrigger
              aria-label="Repository"
              className="!h-8 w-auto min-w-[170px] gap-1.5 font-mono !text-[11px]"
            >
              <SelectValue placeholder="Choose repository…" />
            </SelectTrigger>
            <SelectContent>
              {props.repoOptions.map((r) => (
                <SelectItem key={r.id} value={r.id} className="font-mono text-xs">
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft">
            <Icon className="size-3.5 text-ink-faint" />
            {group.source}
          </span>
        )}
      </div>

      {/* Prompt + actions */}
      <div className="px-4 py-3.5">
        <Textarea
          autoFocus
          aria-label={`New ${noun} prompt`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder={NEW_PLACEHOLDER[group.kind]}
          className="!text-sm"
        />
        <div className="mt-3 flex items-center gap-2">
          <span className={cn('text-[11px]', tooShort || needsRepo ? 'text-ink-faint' : 'text-[var(--sage)]')}>
            {hint}
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            rightIcon={<Plus />}
            onClick={() => props.onAdd(prompt.trim(), isRepo ? repoId : null)}
          >
            Add {noun}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryPane(props: {
  className?: string;
  bodyMd: string;
  version: number | null;
}) {
  return (
    <Card className={cn('flex flex-col', props.className)} aria-label="Synthesized summary">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Exploration summary</CardTitle>
          {props.version ? (
            <Badge variant="sage" size="sm">
              v{props.version}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto !py-5">
        {props.bodyMd ? (
          <ProseBlock className="max-w-none prose-headings:mt-6 prose-headings:mb-2 first:prose-headings:mt-0">
            {props.bodyMd}
          </ProseBlock>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <Loader2 className="size-5 animate-spin text-accent" />
            <p className="text-sm text-ink-faint">Synthesizing exploration findings into a brief...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
