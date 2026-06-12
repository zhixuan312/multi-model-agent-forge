'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Sparkles, Plus, X, ArrowRight, RefreshCw } from 'lucide-react';
import { Markdown } from '@/components/forge/Markdown';
import { AgentRail } from '@/components/forge/AgentRail';
import { BrainDumpComposer, pickRecorderMime } from '@/components/forge/BrainDumpComposer';
import {
  Button,
  Badge,
  EmptyState,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Title,
  TextSm,
  Micro,
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

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-8">
        {/* Inputs — collapse to a compact card once a synthesis exists so the
            document is the focus, but stay editable for adding more tasks. */}
        <details className="group flex flex-col gap-6" open={!bodyMd}>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 text-ink-faint transition-transform group-open:rotate-90" />
            {bodyMd ? 'Brief & sources' : 'Brain-dump'}
          </summary>
          <div className="mt-4 flex flex-col gap-6">
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
            <FanOutEditor
              projectId={props.projectId}
              drafts={drafts}
              repoOptions={props.repoOptions}
              onChanged={refreshTasks}
              onRun={run}
              canRun={drafts.length > 0 && !busy}
            />
          </div>
        </details>

        <SummaryPane
          bodyMd={bodyMd}
          version={version}
          busy={busy}
          onResynthesize={resynthesize}
          projectId={props.projectId}
        />
      </div>

      <aside className="lg:sticky lg:top-4">
        <AgentRail tasks={tasks} />
      </aside>
    </div>
  );
}

/* ── Fan-out editor ───────────────────────────────────────────────────────── */

const GROUPS: { kind: 'investigate' | 'research' | 'journal'; label: string }[] = [
  { kind: 'investigate', label: 'Investigate' },
  { kind: 'research', label: 'Research' },
  { kind: 'journal', label: 'Journal recall' },
];

function FanOutEditor(props: {
  projectId: string;
  drafts: RailTask[];
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

  return (
    <section className="flex flex-col gap-4" aria-label="Proposed fan-out">
      <div className="flex items-center justify-between">
        <TextSm className="!font-semibold !text-ink">Proposed fan-out</TextSm>
        <Button
          size="sm"
          disabled={!props.canRun || anySubFloor}
          onClick={props.onRun}
          rightIcon={<ArrowRight />}
        >
          Run
        </Button>
      </div>

      {GROUPS.map((g) => {
        const items = props.drafts.filter((t) => t.kind === g.kind);
        return (
          <div key={g.kind} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-ink">{g.label}</span>
              <Badge variant="neutral" size="sm">{items.length}</Badge>
              <button
                type="button"
                onClick={() => setAdding(g.kind)}
                className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline"
              >
                <Plus className="size-3" /> add task
              </button>
            </div>
            {items.map((t) => {
              const subFloor = t.prompt.trim().length < promptFloor(t.kind as never);
              return (
                <div key={t.id} className="rounded-[var(--r-md)] border border-line bg-surface-2 p-2">
                  <Textarea
                    aria-label={`${g.label} prompt`}
                    defaultValue={t.prompt}
                    rows={2}
                    onBlur={(e) => patch(t.id, { prompt: e.target.value })}
                    className={cn('!text-xs', subFloor && 'border-[var(--rose)]')}
                  />
                  <div className="mt-1 flex items-center gap-2">
                    {g.kind === 'investigate' ? (
                      <Select
                        defaultValue={t.targetRepoId ?? undefined}
                        onValueChange={(v) => patch(t.id, { targetRepoId: v })}
                      >
                        <SelectTrigger
                          aria-label="Target repository"
                          className="!h-auto w-auto !py-1 !text-[11px]"
                        >
                          <SelectValue placeholder="repo…" />
                        </SelectTrigger>
                        <SelectContent>
                          {props.repoOptions.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    {subFloor ? (
                      <span className="text-[11px] text-[var(--rose)]">
                        ≥ {promptFloor(t.kind as never)} chars
                      </span>
                    ) : null}
                    <span className="flex-1" />
                    <button
                      type="button"
                      aria-label="Remove task"
                      onClick={() => remove(t.id)}
                      className="text-ink-soft transition-colors hover:text-[var(--rose)]"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            {adding === g.kind ? (
              <AddTaskForm
                kind={g.kind}
                repoOptions={props.repoOptions}
                onCancel={() => setAdding(null)}
                onAdd={(prompt, repoId) => add(g.kind, prompt, repoId)}
              />
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function AddTaskForm(props: {
  kind: 'investigate' | 'research' | 'journal';
  repoOptions: { id: string; name: string }[];
  onCancel: () => void;
  onAdd: (prompt: string, repoId: string | null) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [repoId, setRepoId] = useState('');
  const floor = promptFloor(props.kind);
  const valid = prompt.trim().length >= floor && (props.kind !== 'investigate' || repoId);
  return (
    <div className="rounded-[var(--r-md)] border border-dashed border-line-strong bg-surface p-2">
      <Textarea
        aria-label="New task prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        className="!text-xs"
      />
      <div className="mt-1 flex items-center gap-2">
        {props.kind === 'investigate' ? (
          <Select value={repoId || undefined} onValueChange={(v) => setRepoId(v)}>
            <SelectTrigger
              aria-label="New task repository"
              className="!h-auto w-auto !py-1 !text-[11px]"
            >
              <SelectValue placeholder="repo…" />
            </SelectTrigger>
            <SelectContent>
              {props.repoOptions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          cancel
        </Button>
        <Button
          size="sm"
          disabled={!valid}
          onClick={() => props.onAdd(prompt.trim(), props.kind === 'investigate' ? repoId : null)}
        >
          add
        </Button>
      </div>
    </div>
  );
}

function SummaryPane(props: {
  bodyMd: string | null;
  version: number | null;
  busy: boolean;
  onResynthesize: () => void;
  projectId: string;
}) {
  if (!props.bodyMd) {
    return (
      <section aria-label="Synthesized summary">
        <EmptyState
          icon={<Sparkles />}
          title="Exploration summary"
          description="No synthesis yet — run the tasks above to ground the brief, and the summary appears here."
        />
      </section>
    );
  }

  return (
    <section
      aria-label="Synthesized summary"
      className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-sm"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-6 py-3">
          <Title className="!text-lg">
            Exploration summary
            {props.version ? (
              <Badge variant="sage" size="sm" className="ml-2 align-middle">
                v{props.version}
              </Badge>
            ) : null}
          </Title>
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
        </header>

        <div className="px-6 py-5">
          <Markdown className="max-w-[72ch] prose-headings:mt-6 prose-headings:mb-2 first:prose-headings:mt-0">
            {props.bodyMd}
          </Markdown>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line bg-surface-2/60 px-6 py-3">
          <Micro className="!text-ink-faint">This brief grounds the Spec stage.</Micro>
          <a
            href={`/projects/${props.projectId}/spec`}
            className="inline-flex items-center gap-1.5 rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-deep"
          >
            Continue to Spec <ArrowRight className="size-4" />
          </a>
        </footer>
    </section>
  );
}
