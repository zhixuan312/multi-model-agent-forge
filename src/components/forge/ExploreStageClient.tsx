'use client';

import { useEffect, useState } from 'react';
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
import { RailStatus, type RailStatusItem } from '@/components/patterns/feature-rail';
import { ConversationComposer } from '@/components/patterns/conversation';
import { RailNote } from '@/components/patterns/feature-rail';
import { StageShell, StageFullWidth, type StageShellItem } from '@/components/patterns/stage-shell';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { StageAdvance } from '@/components/forge/StageAdvance';
import { AutomationBar } from '@/components/forge/AutomationBar';
import {
  Button,
  Badge,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Micro,
  Eyebrow,
  TextSm,
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
import type { AttachmentView } from '@/exploration/attachments';
import { cn } from '@/lib/cn';

/** Per-route prompt floor — pulled from the client-safe schema constants. */
const promptFloor = (kind: 'investigate' | 'research' | 'journal'): number => PROMPT_FLOORS[kind];

/**
 * `ExploreStageClient` (Spec 5) — the exploration stage island. Brain-dump
 * composer (text · voice · attachments) → editable fan-out task list → Run →
 * live agent rail (via `useProjectEvents`) → synthesized summary. The DB is the
 * source of truth; SSE patches the TanStack cache for live updates.
 */

interface ExploreStageClientProps {
  projectId: string;
  projectName: string;
  initialBrief: string;
  initialAttachments: AttachmentView[];
  initialTasks: RailTask[];
  initialArtifact: { id: string; version: number; bodyMd: string } | null;
  repoOptions: { id: string; name: string }[];
  voiceEnabled: boolean;
  canMutate?: boolean;
  lockedReason?: string;
  initialPhase?: 'brief' | 'discover' | 'synthesize';
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
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
  const [attachments, setAttachments] = useState<AttachmentView[]>(props.initialAttachments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewOverride, setViewOverride] = useState<'brief' | 'discover' | 'synthesize' | null>(props.initialPhase ?? null);

  const drafts = tasks.filter((t) => t.status === 'draft');

  function refreshTasks(): void {
    void qc.invalidateQueries({ queryKey: explorationKeys.tasks(props.projectId) });
  }

  async function analyze(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/projects/${props.projectId}/explore/brief`, { text: brief });
      await postJson<{ batchId: string }>(
        `/api/projects/${props.projectId}/explore/propose`,
        {},
      );
      // Route returns 202 — SSE dispatch.done will trigger refresh
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.');
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/projects/${props.projectId}/explore/run`, {});
      refreshTasks();
      // Agents finish a beat after dispatch — re-poll so running → recorded shows.
      setTimeout(refreshTasks, 2600);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dispatch failed.');
    } finally {
      setBusy(false);
    }
  }

  async function resynthesize(): Promise<void> {
    setBusy(true);
    try {
      await postJson(`/api/projects/${props.projectId}/explore/synthesize`, {});
      // Route returns 202 — SSE dispatch.done will trigger refresh
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Synthesis failed.');
      setBusy(false);
    }
  }

  // SSE listener for dispatch events (propose + synthesize completion)
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/projects/${props.projectId}/events`);
    const onMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'dispatch.done' && (data.handler === 'explore-propose' || data.handler === 'explore-synthesize')) {
          setBusy(false);
          refreshTasks();
          if (data.handler === 'explore-synthesize') {
            fetch(`/api/projects/${props.projectId}/explore/artifact`)
              .then((r) => r.ok ? r.json() : null)
              .then((a) => { if (a) qc.setQueryData(explorationKeys.artifact(props.projectId), a as ArtifactCacheEntry); })
              .catch(() => {});
          }
        }
        if (data.type === 'dispatch.failed' && (data.handler === 'explore-propose' || data.handler === 'explore-synthesize')) {
          setBusy(false);
          setError(data.error ?? 'Task failed.');
        }
      } catch { /* ignore parse errors */ }
    };
    es.onmessage = onMessage;
    return () => es.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectId]);

  async function addLink(): Promise<void> {
    const url = window.prompt('Link URL (http/https):');
    if (!url) return;
    const label = window.prompt('Label:', url) ?? url;
    try {
      const v = await postJson<AttachmentView>(`/api/projects/${props.projectId}/explore/attachment`, { label, url });
      setAttachments((a) => [...a, v]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attach failed.');
    }
  }

  async function addFile(file: File): Promise<void> {
    const kind = file.type.startsWith('image/') ? 'image' : 'file';
    const form = new FormData();
    form.append('kind', kind);
    form.append('label', file.name);
    form.append('file', file);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/explore/attachment`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Attach failed.');
      const view = (await res.json()) as AttachmentView;
      setAttachments((a) => [...a, view]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attach failed.');
    }
  }

  async function removeAttachment(attachmentId: string): Promise<void> {
    await fetch(`/api/projects/${props.projectId}/explore/attachment/${attachmentId}`, { method: 'DELETE' });
    setAttachments((a) => a.filter((x) => x.id !== attachmentId));
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

  // Publish the sub-phase to the stepper + register the navigation handler.
  useEffect(() => {
    if (viewOverride) {
      stagePhaseStore.set(viewOverride);
    } else {
      const sub = phase === 'synthesis' ? 'synthesize' : phase === 'idle' ? 'brief' : phase === 'fanout' ? 'brief' : 'discover';
      stagePhaseStore.set(sub);
    }
  }, [phase, viewOverride]);

  useEffect(() => {
    return stagePhaseStore.onNavigate((key) => {
      setViewOverride(key as 'brief' | 'discover' | 'synthesize');
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('phase', key);
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    });
  }, []);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(tasks.find((t) => t.status !== 'draft')?.id ?? null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const taskItems: StageShellItem[] = tasks
    .filter((t) => t.status !== 'draft')
    .map((t) => {
      let status: string;
      let statusVariant: StageShellItem['statusVariant'];
      if (t.batchStatus === 'failed') { status = 'failed'; statusVariant = 'rose'; }
      else if (t.status === 'recorded' || t.batchStatus === 'done') { status = 'recorded'; statusVariant = 'sage'; }
      else { status = 'running'; statusVariant = 'amber'; }
      const LABEL: Record<string, string> = { investigate: 'Investigate', research: 'Research', journal: 'Journal recall' };
      return { id: t.id, label: LABEL[t.kind] ?? t.kind, description: t.prompt, status, statusVariant };
    });

  const noteEl = <ExplorationNote phase={phase} />;
  const hasAnalyzed = dispatched > 0 || drafts.length > 0;
  const [railMode, setRailMode] = useState<'conversation' | 'status'>(hasAnalyzed ? 'status' : 'conversation');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <AutomationBar
        mode="off"
        note=""
        disabled
        idleHint="Automation unlocks once the spec is set — Design stages are hand-authored."
        onRun={() => {}}
        onStop={() => {}}
      />

      {/* Brief phase: original layout — content left, brain-dump/status right */}
      {(phase === 'idle' || phase === 'fanout') ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
          <div className="flex min-h-0 flex-col lg:col-span-2">
            {phase === 'idle' ? (
              <IdleStage />
            ) : (
              <FanOutCard
                className="min-h-0 flex-1"
                projectId={props.projectId}
                drafts={drafts}
                allTasks={tasks}
                repoOptions={props.repoOptions}
                onChanged={refreshTasks}
                onRun={run}
                canRun={drafts.length > 0 && !busy && !locked}
              />
            )}
          </div>
          <aside className="flex min-h-0 flex-col gap-4">
            {noteEl}
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>{railMode === 'conversation' ? 'Brain-dump' : 'Exploration'}</CardTitle>
                  {dispatched > 0 ? (
                    <Badge variant={allDone ? 'sage' : 'amber'} size="sm">
                      {allDone ? 'complete' : `${recorded}/${dispatched}`}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 rounded-full bg-surface-2 p-0.5">
                  <button type="button" onClick={() => setRailMode('conversation')} className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors', railMode === 'conversation' ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink')}>
                    Edit
                  </button>
                  <button type="button" onClick={() => hasAnalyzed && setRailMode('status')} disabled={!hasAnalyzed} className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors', !hasAnalyzed && 'opacity-40 cursor-not-allowed', railMode === 'status' ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink')}>
                    Status
                  </button>
                </div>
              </CardHeader>

              {railMode === 'conversation' ? (
                <CardContent className="flex min-h-0 flex-1 flex-col !py-4">
                  <ConversationComposer
                    value={brief}
                    onChange={locked ? () => {} : setBrief}
                    onSend={locked ? () => {} : () => { analyze(); setRailMode('status'); }}
                    voice={props.voiceEnabled && !locked}
                    attachments
                    disabled={locked}
                    loading={busy}
                    placeholder="Tell Forge everything you know…"
                    submitLabel={busy ? 'Thinking…' : 'Analyze sources'}
                    rows={0}
                    className="flex min-h-0 flex-1 flex-col gap-3 border-0 px-0 py-0"
                  />
                  {error ? <p className="mt-2 text-sm text-[var(--rose)]">{error}</p> : null}
                </CardContent>
              ) : (
                <>
                  <CardContent className="min-h-0 flex-1 !py-4">
                    <div className="space-y-0">
                      <StatRow label="Total tasks" value={String(tasks.length)} />
                      <StatRow label="Investigations" value={String(tasks.filter((t) => t.kind === 'investigate').length)} />
                      <StatRow label="Research" value={String(tasks.filter((t) => t.kind === 'research').length)} />
                      <StatRow label="Journal recalls" value={String(tasks.filter((t) => t.kind === 'journal').length)} />
                    </div>
                  </CardContent>
                  <CardFooter className="flex-col !items-stretch gap-2">
                    <Button
                      className="w-full"
                      onClick={() => {
                        if (!hasAnalyzed) { analyze(); }
                        setViewOverride('discover');
                      }}
                      disabled={locked || busy || !brief.trim()}
                      loading={busy}
                      leftIcon={<ArrowRight />}
                    >
                      {busy ? 'Analyzing…' : hasAnalyzed ? 'Continue to Discover' : 'Analyze & Discover'}
                    </Button>
                  </CardFooter>
                </>
              )}
            </Card>
          </aside>
        </div>

      /* Discover phase: task list in rail, selected task detail in main */
      ) : phase === 'run' ? (
        <StageShell
          note={noteEl}
          items={taskItems}
          activeId={selectedTaskId}
          onSelect={setSelectedTaskId}
          listTitle="Tasks"
          listProgress={`${recorded}/${dispatched}`}
          listActions={allDone ? (
            <Button onClick={locked ? () => {} : resynthesize} loading={busy} disabled={locked || busy} leftIcon={<Sparkles />} className="w-full">
              {busy ? 'Synthesizing…' : 'Synthesize brief'}
            </Button>
          ) : undefined}
          footer={
            <StageAdvance
              href={`/projects/${props.projectId}/spec`}
              label="Continue to Spec"
              disabled={!bodyMd || !allDone}
              projectId={props.projectId}
              from="exploration"
            />
          }
        >
          <CardHeader>
            <CardTitle>{selectedTask ? (taskItems.find((t) => t.id === selectedTaskId)?.label ?? '') : 'Select a task'}</CardTitle>
          </CardHeader>
          {selectedTask ? (
            <div className="border-b border-line px-5 py-3">
              <Eyebrow className="mb-1 !text-ink-faint">Prompt</Eyebrow>
              <p className="text-sm leading-relaxed text-ink">{selectedTask.prompt}</p>
            </div>
          ) : null}
          <CardContent className="min-h-0 flex-1 overflow-y-auto !py-4">
            {!selectedTask ? (
              <div className="grid h-full place-items-center">
                <p className="text-sm text-ink-faint">Select a task from the list to view its output.</p>
              </div>
            ) : selectedTask.batchStatus === 'failed' ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <p className="text-sm font-medium text-[var(--rose)]">Task failed</p>
                <p className="text-xs text-ink-soft">{selectedTask.error?.message ?? 'Unknown error.'}</p>
              </div>
            ) : selectedTask.status !== 'recorded' && selectedTask.batchStatus !== 'done' ? (
              <div className="grid h-full place-items-center">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="size-6 animate-spin text-accent" />
                  <p className="text-sm text-ink-faint">{selectedTask.headline ?? 'Running…'}</p>
                </div>
              </div>
            ) : selectedTask.outputMd ? (
              <>
                <Eyebrow className="mb-2 !text-ink-faint">Findings</Eyebrow>
                <ProseBlock variant="document">{selectedTask.outputMd}</ProseBlock>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-ink-faint">No output available.</p>
            )}
          </CardContent>
        </StageShell>

      /* Synthesize phase: full-width summary */
      ) : (
        <StageFullWidth note={noteEl}>
          <SummaryPane
            className="min-h-0 flex-1"
            bodyMd={bodyMd as string}
            version={version}
            busy={busy}
            onResynthesize={locked ? () => {} : resynthesize}
            locked={locked}
            projectId={props.projectId}
          />
        </StageFullWidth>
      )}
    </div>
  );
}

/** Centre stage before any analysis — points the user at the brain-dump input. */
function IdleStage() {
  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardContent className="grid min-h-0 flex-1 place-items-center px-6 text-center">
        <div className="max-w-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-accent-tint text-accent">
            <Sparkles className="size-6" />
          </span>
          <Title as="h3" className="mt-4 !text-lg">
            Start with your context
          </Title>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Tell Forge everything you know in the brain-dump on the right, then press{' '}
            <span className="font-medium text-ink">Run analysis</span>. Forge proposes an investigation · research ·
            recall fan-out right here — you run it, then synthesize one grounded brief.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

const ROUTE_LABEL: Record<string, string> = {
  investigate: 'Investigate',
  research: 'Research',
  journal: 'Journal recall',
};

function toStatusItems(tasks: RailTask[]): RailStatusItem[] {
  return tasks.filter((t) => t.status !== 'draft').map((t) => {
    let status: string;
    let tone: RailStatusItem['tone'];
    if (t.batchStatus === 'failed') { status = 'failed'; tone = 'fail'; }
    else if (t.status === 'recorded' || t.batchStatus === 'done') { status = 'recorded'; tone = 'done'; }
    else if (t.status === 'draft') { status = 'draft'; tone = 'idle'; }
    else { status = 'running'; tone = 'run'; }
    return { id: t.id, label: ROUTE_LABEL[t.kind] ?? t.kind, status, tone, detail: t.prompt, error: t.error?.message };
  });
}

function RunStage(props: {
  className?: string;
  tasks: RailTask[];
  dispatched: number;
  recorded: number;
  allDone: boolean;
  synthesizing: boolean;
  onSynthesize: () => void;
  locked?: boolean;
}) {
  return (
    <Card className={cn('flex flex-col', props.className)} aria-label="Agent run">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{props.allDone ? 'Agents finished' : 'Agents at work'}</CardTitle>
          <Badge variant={props.allDone ? 'sage' : 'amber'} size="sm">
            {props.recorded}/{props.dispatched} done
          </Badge>
        </div>
        {props.allDone ? (
          <Button
            size="sm"
            onClick={props.onSynthesize}
            loading={props.synthesizing}
            disabled={props.synthesizing || !!props.locked}
            leftIcon={<Sparkles />}
          >
            {props.synthesizing ? 'Synthesizing...' : 'Synthesize brief'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto !py-4">
        <RailStatus items={toStatusItems(props.tasks)} live emptyText="No tasks dispatched yet." />
      </CardContent>
    </Card>
  );
}

/** Standing guidance — the accent-tint note every page's rail carries. */
const PHASE_NOTES: Record<string, string> = {
  brief: `### Brief — describe the idea

- **Brain-dump** — tell Forge everything you know about the problem
- **Attach context** — screenshots, docs, data files, or paste links
- **Analyze** — Forge proposes investigation, research, and journal recall tasks

### Tips

- More context = better research plan
- You can always edit and re-analyze`,

  discover: `### Discover — agents at work

- **Edit tasks** — add, remove, or refine before running
- **Run** — agents investigate the codebase, research the web, and recall past decisions
- **Live status** — each task shows its progress in the rail

### Task types

- **Investigate** — deep-dive into a specific repo or codebase area
- **Research** — web search for external context
- **Journal recall** — surface relevant past learnings`,

  synthesize: `### Synthesize — build the brief

- **Synthesize** — Forge consolidates all findings into one grounded brief
- **Re-synthesize** — run again if you added more context
- **Advance** — the brief carries forward into the Spec stage

### What makes a good brief

- Covers the problem, constraints, and known prior art
- Grounded in evidence from investigation and research`,
};

function ExplorationNote({ phase }: { phase: string }) {
  const key = phase === 'idle' ? 'brief' : phase === 'fanout' ? 'discover' : phase === 'run' ? 'discover' : 'synthesize';
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
        <div className="flex items-center gap-2">
          <CardTitle>{recorded.length > 0 && props.drafts.length === 0 ? 'Exploration tasks' : 'Proposed fan-out'}</CardTitle>
          <Badge variant="neutral" size="sm">
            {totalCount}
          </Badge>
        </div>
        {props.drafts.length > 0 ? (
          <Button size="sm" disabled={!props.canRun || anySubFloor} onClick={props.onRun} rightIcon={<ArrowRight />}>
            Run
          </Button>
        ) : null}
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
                          !isDraft && 'opacity-75',
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
                          <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">{t.prompt}</p>
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
                      className="flex min-h-[7rem] flex-col items-center justify-center gap-1.5 rounded-[var(--r-md)] border border-dashed border-line-strong text-sm font-medium text-ink-soft transition-colors hover:border-accent hover:bg-accent-tint/30 hover:text-accent"
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
  busy: boolean;
  onResynthesize: () => void;
  projectId: string;
  locked?: boolean;
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
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<RefreshCw />}
          onClick={props.onResynthesize}
          loading={props.busy}
          disabled={props.busy || !!props.locked}
        >
          {props.busy ? 'Synthesizing...' : 'Re-synthesize'}
        </Button>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-y-auto !py-5">
        <ProseBlock className="max-w-none prose-headings:mt-6 prose-headings:mb-2 first:prose-headings:mt-0">
          {props.bodyMd}
        </ProseBlock>
      </CardContent>

      <CardFooter className="flex-col !items-stretch gap-2">
        <TextSm className="!text-ink-faint">This brief grounds the Spec stage.</TextSm>
        <StageAdvance href={`/projects/${props.projectId}/spec`} label="Continue to Spec" projectId={props.projectId} from="exploration" />
      </CardFooter>
    </Card>
  );
}
