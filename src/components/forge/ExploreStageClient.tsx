'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  Plus,
  X,
  ArrowRight,
  RefreshCw,
  Paperclip,
  Radar,
  FileText,
  Lightbulb,
  ScanSearch,
  Globe,
  History,
  FolderGit2,
  Loader2,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { Markdown } from '@/components/forge/Markdown';
import { AgentRail } from '@/components/forge/AgentRail';
import { BrainDumpComposer, pickRecorderMime } from '@/components/forge/BrainDumpComposer';
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
  Title,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Eyebrow,
  MetricCard,
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
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recStartRef = useRef<number>(0);

  const drafts = tasks.filter((t) => t.status === 'draft');

  function refreshTasks(): void {
    void qc.invalidateQueries({ queryKey: explorationKeys.tasks(props.projectId) });
  }

  async function analyze(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/projects/${props.projectId}/explore/brief`, { text: brief });
      const res = await postJson<{ tasks: unknown[]; empty?: boolean }>(
        `/api/projects/${props.projectId}/explore/propose`,
        {},
      );
      if (res.empty) setError('No tasks proposed — add tasks manually below.');
      refreshTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.');
    } finally {
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
      // Seed the artifact cache directly (the summary appears without SSE).
      const r = await fetch(`/api/projects/${props.projectId}/explore/artifact`);
      if (r.ok) {
        const a = (await r.json()) as ArtifactCacheEntry | null;
        if (a) qc.setQueryData(explorationKeys.artifact(props.projectId), a);
      }
    } catch {
      /* non-blocking — prior version retained */
    } finally {
      setBusy(false);
    }
  }

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

  async function toggleRecord(): Promise<void> {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMime();
      const rec = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recStartRef.current = Date.now();
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const form = new FormData();
        form.append('file', blob, 'audio');
        form.append('durationMs', String(Date.now() - recStartRef.current));
        try {
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          if (!res.ok) throw new Error('Transcription failed.');
          const { text } = (await res.json()) as { text: string };
          setBrief((prev) => (prev ? `${prev} ${text}` : text)); // APPEND, never replace
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Transcription failed.');
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError('Microphone unavailable.');
    }
  }

  const bodyMd = artifact?.bodyMd ?? props.initialArtifact?.bodyMd ?? null;
  const version = artifact?.version ?? props.initialArtifact?.version ?? null;
  const dispatched = tasks.filter((t) => t.status !== 'draft').length;
  const recorded = tasks.filter((t) => t.status === 'recorded').length;
  const allDone = dispatched > 0 && recorded === dispatched;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* STATUS — the stage at a glance */}
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Sources"
          value={attachments.length}
          muted={attachments.length === 0}
          sublabel="Links & files"
          icon={<Paperclip />}
          iconTint="steel"
        />
        <MetricCard
          label="Proposed"
          value={drafts.length}
          muted={drafts.length === 0}
          sublabel="Fan-out tasks"
          icon={<Sparkles />}
          iconTint="accent"
        />
        <MetricCard
          label="Dispatched"
          value={dispatched}
          muted={dispatched === 0}
          sublabel="Agents working"
          icon={<Radar />}
          iconTint="sage"
        />
        <MetricCard
          label="Synthesis"
          value={version ? `v${version}` : '—'}
          muted={!version}
          sublabel="Grounded brief"
          icon={<FileText />}
          iconTint="amber"
        />
      </div>

      {/* PRIMARY composer + fan-out (2/3) ∣ agent rail (1/3), fills to the bottom */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        <div className="flex min-h-0 flex-col gap-4 lg:col-span-2">
          <Card className="shrink-0">
            <CardHeader>
              <CardTitle>Brain-dump</CardTitle>
              <Micro className="!text-ink-faint">Everything you know — text · links · files</Micro>
            </CardHeader>
            <CardContent className="!py-5">
              <BrainDumpComposer
                value={brief}
                onChange={setBrief}
                attachments={attachments}
                voiceEnabled={props.voiceEnabled}
                recording={recording}
                busy={busy}
                error={error}
                onAnalyze={analyze}
                onToggleRecord={toggleRecord}
                onAddLink={addLink}
                onAddFile={addFile}
                onRemoveAttachment={removeAttachment}
              />
            </CardContent>
          </Card>

          {bodyMd ? (
            <SummaryPane
              className="min-h-0 flex-1"
              bodyMd={bodyMd}
              version={version}
              busy={busy}
              onResynthesize={resynthesize}
              projectId={props.projectId}
            />
          ) : (
            <FanOutCard
              className="min-h-0 flex-1"
              projectId={props.projectId}
              drafts={drafts}
              dispatched={dispatched}
              recorded={recorded}
              allDone={allDone}
              synthesizing={busy}
              onSynthesize={resynthesize}
              repoOptions={props.repoOptions}
              onChanged={refreshTasks}
              onRun={run}
              canRun={drafts.length > 0 && !busy}
            />
          )}
        </div>

        <aside className="flex min-h-0 flex-col gap-4">
          <ExplorationNote />
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-center gap-2">
                <Eyebrow as="h3" className="text-ink-faint">
                  Agent rail
                </Eyebrow>
                {dispatched > 0 ? (
                  <Badge variant="neutral" size="sm">
                    {dispatched}
                  </Badge>
                ) : null}
              </div>
              <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
                <AgentRail tasks={tasks} />
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** Standing guidance — the accent-tint note every page's rail carries. */
function ExplorationNote() {
  return (
    <div className="flex shrink-0 items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4">
      <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent">
        <Lightbulb className="size-5" />
      </span>
      <div className="min-w-0">
        <Eyebrow as="h3" className="text-accent-deep">
          How exploration works
        </Eyebrow>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          Dump everything you know, then <span className="font-medium text-ink">Analyze sources</span> to propose a
          fan-out. Forge&rsquo;s agents investigate the codebase, research the web, and recall past decisions — then
          synthesize one grounded brief for the Spec stage.
        </p>
      </div>
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
  dispatched: number;
  recorded: number;
  allDone: boolean;
  synthesizing: boolean;
  onSynthesize: () => void;
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
  const empty = props.drafts.length === 0;
  const repoName = (id: string | null): string =>
    props.repoOptions.find((r) => r.id === id)?.name ?? 'unassigned';

  return (
    <Card className={cn('flex flex-col', props.className)} aria-label="Proposed fan-out">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Proposed fan-out</CardTitle>
          {!empty ? (
            <Badge variant="neutral" size="sm">
              {props.drafts.length}
            </Badge>
          ) : null}
        </div>
        <Button size="sm" disabled={!props.canRun || anySubFloor} onClick={props.onRun} rightIcon={<ArrowRight />}>
          Run
        </Button>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 space-y-7 overflow-y-auto !py-5">
        {empty ? (
          !props.dispatched ? (
            <div className="grid h-full place-items-center py-12 text-center">
              <div>
                <span className="mx-auto grid size-10 place-items-center rounded-full bg-accent-tint text-accent">
                  <Sparkles className="size-5" />
                </span>
                <p className="mx-auto mt-3 max-w-xs text-sm text-ink-soft">
                  Run <span className="font-medium text-ink">Analyze sources</span> above and Forge proposes an
                  investigate · research · recall fan-out here.
                </p>
              </div>
            </div>
          ) : !props.allDone ? (
            <div className="grid h-full place-items-center py-12 text-center">
              <div>
                <span className="mx-auto grid size-10 place-items-center rounded-full bg-amber-tint text-[var(--amber)]">
                  <Loader2 className="size-5 animate-spin" />
                </span>
                <p className="mx-auto mt-3 max-w-xs text-sm text-ink-soft">
                  Agents are working —{' '}
                  <span className="font-medium text-ink">
                    {props.recorded} of {props.dispatched}
                  </span>{' '}
                  done. Watch each report in the agent rail.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center py-12 text-center">
              <div>
                <span className="mx-auto grid size-10 place-items-center rounded-full bg-sage-tint text-[var(--sage)]">
                  <CheckCircle2 className="size-5" />
                </span>
                <p className="mx-auto mb-4 mt-3 max-w-xs text-sm text-ink-soft">
                  All {props.dispatched} agents finished. Synthesize their findings into one grounded brief for the
                  Spec stage.
                </p>
                <Button
                  onClick={props.onSynthesize}
                  loading={props.synthesizing}
                  disabled={props.synthesizing}
                  leftIcon={<Sparkles />}
                >
                  {props.synthesizing ? 'Synthesizing…' : 'Synthesize brief'}
                </Button>
              </div>
            </div>
          )
        ) : (
          GROUPS.map((g) => {
            const items = props.drafts.filter((t) => t.kind === g.kind);
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
                    const subFloor = t.prompt.trim().length < promptFloor(t.kind as never);
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          'group/task flex flex-col rounded-[var(--r-md)] border bg-surface p-3.5 shadow-sm transition-colors hover:border-line-strong',
                          subFloor ? 'border-[var(--rose)]/60' : 'border-line',
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
                          <button
                            type="button"
                            aria-label="Remove task"
                            onClick={() => remove(t.id)}
                            className="-mr-1 shrink-0 rounded p-1 text-ink-faint opacity-0 transition-all hover:bg-surface-2 hover:text-[var(--rose)] focus-visible:opacity-100 group-hover/task:opacity-100"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>

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
          })
        )}
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
          disabled={props.busy}
        >
          {props.busy ? 'Synthesizing…' : 'Re-synthesize'}
        </Button>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-y-auto !py-5">
        <Markdown className="max-w-none prose-headings:mt-6 prose-headings:mb-2 first:prose-headings:mt-0">
          {props.bodyMd}
        </Markdown>
      </CardContent>

      <CardFooter>
        <Micro className="!text-ink-faint">This brief grounds the Spec stage.</Micro>
        <a
          href={`/projects/${props.projectId}/spec`}
          className="inline-flex items-center gap-1.5 rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-deep"
        >
          Continue to Spec <ArrowRight className="size-4" />
        </a>
      </CardFooter>
    </Card>
  );
}
