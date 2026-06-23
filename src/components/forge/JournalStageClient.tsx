'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Plus,
  NotebookPen,
  FileText,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ForgeMark } from '@/components/forge/ForgeMark';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  TextSm,
} from '@/components/ui';
import { ForgeComposer } from '@/components/forge/ForgeComposer';
import type { ProjectPhase } from '@/db/enums';
import { LEARNING_CATEGORIES, type LearningCategory, type LearningSource } from '@/journal/types';

/* ── Types ─────────────────────────────────────────────────────── */

interface JournalMsg {
  id: string;
  role: 'forge' | 'user';
  text: string;
  isDraft?: boolean;
}

export interface JournalLearningView {
  id: string;
  num: number;
  text: string;
  category: LearningCategory;
  source: LearningSource;
  status: 'proposed' | 'kept' | 'recorded';
  isManual: boolean;
  recordedNodeId?: string | null;
}

export interface JournalStageClientProps {
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
  learnings: JournalLearningView[];
  harvesting: boolean;
  recording: boolean;
  activeLearningId?: string;
}

const CATEGORY_STYLE: Record<LearningCategory, string> = {
  decision: 'bg-accent-tint text-accent',
  design: 'bg-[var(--frost)] text-[var(--steel)]',
  behavior: 'bg-sage-tint text-[var(--sage-deep)]',
  process: 'bg-amber-tint text-[var(--amber)]',
  knowledge: 'bg-rose-tint text-[var(--rose)]',
  style: 'bg-surface-2 text-ink-soft',
};

let _nid = 0;
const nid = () => `jm-${++_nid}`;

function frameLearning(raw: string): string {
  let s = raw.trim();
  const strips = [
    /^(?:so|well|ok|okay|um|hmm|basically|essentially|honestly|like|just)[,\s]+/i,
    /^(?:the learning is|the point is|the key thing is|key takeaway is)[:,\s]+/i,
    /^(?:we|i|the team|you)\s+(?:learned|found|noticed|realised|realized|saw|think|feel|believe)\s+(?:that\s+)?/i,
    /^it\s+(?:turns out\s+)?(?:that\s+)?/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of strips) {
      const next = s.replace(re, '');
      if (next !== s) { s = next; changed = true; }
    }
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += '.';
  return s || raw;
}

/* ── Main Component ────────────────────────────────────────────── */

export function JournalStageClient(props: JournalStageClientProps) {
  const router = useRouter();
  const readOnly = props.phase !== 'build' && props.phase !== 'learn';

  const [activeId, setActiveId] = useState<string>(props.activeLearningId ?? props.learnings[0]?.id ?? '');
  const [threads, setThreads] = useState<Record<string, JournalMsg[]>>({});
  const [draftViews, setDraftViews] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');
  const [harvesting, setHarvesting] = useState(props.harvesting);
  const [recording, setRecording] = useState(props.recording);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = props.learnings.find((l) => l.id === activeId);
  const approvedCount = props.learnings.filter((l) => l.status === 'kept' || l.status === 'recorded').length;
  const isDraftView = draftViews.has(activeId);

  // Whether the user has started a conversation (typed something) for this learning
  const hasConversation = !!(threads[activeId]?.length);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [threads, activeId]);

  // Auto-harvest on first visit (no learnings, not already harvesting)
  useEffect(() => {
    if (props.learnings.length === 0 && !harvesting && !readOnly) {
      harvest();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE listener
  useEffect(() => {
    if (!harvesting && !recording) return;
    const es = new EventSource(`/api/projects/${props.projectId}/events`);
    es.onmessage = (msg) => {
      try {
        const e = JSON.parse(msg.data) as Record<string, unknown>;
        if ((e.type === 'dispatch.done' || e.type === 'dispatch.failed') &&
            (e.handler === 'journal-harvest' || e.handler === 'journal-record')) {
          window.location.reload();
        }
      } catch {}
    };
    return () => es.close();
  }, [harvesting, recording, props.projectId]);

  // URL sync
  function switchLearning(id: string) {
    setActiveId(id);
    setInput('');
    const url = new URL(window.location.href);
    url.searchParams.set('learning', id);
    router.push(url.pathname + url.search, { scroll: false });
  }

  // Get current draft text (last draft message in thread)
  function currentDraft(): string {
    const msgs = threads[activeId] ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].isDraft) return msgs[i].text;
    }
    return active?.text ?? '';
  }

  function submit() {
    const text = input.trim();
    if (!text || !active) return;
    setInput('');
    const reframed = frameLearning(text);
    const existing = threads[active.id] ?? [];
    setThreads((t) => ({
      ...t,
      [active.id]: [
        ...existing,
        { id: nid(), role: 'user', text },
        { id: nid(), role: 'forge', text: 'Updated:' },
        { id: nid(), role: 'forge', text: reframed, isDraft: true },
      ],
    }));
  }

  async function harvest() {
    setHarvesting(true);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/journal/harvest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) setHarvesting(false);
    } catch { setHarvesting(false); }
  }

  async function approve() {
    if (!active) return;
    const draft = currentDraft();
    await fetch(`/api/projects/${props.projectId}/journal/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learningId: active.id, action: 'approve', text: draft }),
    });
    window.location.reload();
  }

  async function revoke() {
    if (!active) return;
    await fetch(`/api/projects/${props.projectId}/journal/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learningId: active.id, action: 'revoke' }),
    });
    window.location.reload();
  }

  async function addLearning() {
    const res = await fetch(`/api/projects/${props.projectId}/journal/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'New learning', category: 'knowledge', source: 'Manual' }),
    });
    if (res.ok) window.location.reload();
  }

  async function record() {
    setRecording(true);
    try {
      const res = await fetch(`/api/projects/${props.projectId}/journal/record`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) setRecording(false);
    } catch { setRecording(false); }
  }

  const isApproved = active?.status === 'kept' || active?.status === 'recorded';

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="journal-stage">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">

        {/* LEFT — conversation or state card */}
        <Card className="flex min-h-0 flex-col lg:col-span-2">
          {props.learnings.length === 0 && !harvesting ? (
            <>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <NotebookPen className="size-4 shrink-0 text-accent" />
                  <CardTitle>Learnings</CardTitle>
                  <Badge variant="neutral" size="sm">no learnings yet</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-16">
                <NotebookPen className="size-8 text-ink-faint/30" />
                <p className="text-sm font-medium text-ink-soft">No learnings yet</p>
                <p className="text-center text-xs text-ink-faint" style={{ maxWidth: 280 }}>
                  Harvest AI learnings from the full project run, or add your own manually.
                </p>
              </CardContent>
            </>
          ) : harvesting && props.learnings.length === 0 ? (
            <>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
                  <CardTitle>Harvesting learnings</CardTitle>
                  <Badge variant="accent" size="sm">harvesting</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-16">
                <Loader2 className="size-8 animate-spin text-accent" />
                <p className="text-sm font-medium text-ink">Extracting learnings from the project run…</p>
                <p className="text-center text-xs text-ink-faint" style={{ maxWidth: 300 }}>
                  MMA is analyzing all 5 stages: Exploration, Spec, Plan, Execute, Review.
                </p>
              </CardContent>
            </>
          ) : recording ? (
            <>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
                  <CardTitle>Writing to journal</CardTitle>
                  <Badge variant="accent" size="sm">recording</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-16">
                <Loader2 className="size-8 animate-spin text-accent" />
                <p className="text-sm font-medium text-ink">Recording {approvedCount} learnings to .mma/journal/</p>
              </CardContent>
            </>
          ) : active && !isDraftView ? (
            /* Conversation mode (default) — empty unless user has typed */
            <>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-accent-tint text-accent">
                    <NotebookPen className="size-4" />
                  </span>
                  <CardTitle>{active.text.slice(0, 50)}{active.text.length > 50 ? '…' : ''}</CardTitle>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CATEGORY_STYLE[active.category])}>{active.category}</span>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
                  {active.source}
                </span>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 overflow-y-auto bg-surface-2/40 !py-5">
                {hasConversation ? (
                  <div className="space-y-5">
                    {(threads[active.id] ?? []).map((m) => (
                      m.role === 'forge' ? (
                        <div key={m.id} className="flex gap-2.5">
                          <ForgeMark className="mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="mb-1"><span className="text-xs font-semibold text-ink">Forge</span></div>
                            {m.isDraft ? (
                              <div className="rounded-[var(--r-md)] border-l-[3px] border-accent bg-surface-2 px-4 py-3">
                                <div className="mb-1 flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold uppercase tracking-wide text-accent">Draft learning</span>
                                </div>
                                <p className="text-sm leading-relaxed text-ink">{m.text}</p>
                              </div>
                            ) : (
                              <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
                                <p className="text-sm leading-relaxed text-ink">{m.text}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div key={m.id} className="flex justify-end gap-2.5">
                          <div className="max-w-[80%] rounded-2xl rounded-tr-md border border-[rgba(53,90,116,0.15)] bg-[var(--frost)] px-4 py-3 shadow-sm">
                            <p className="text-sm leading-relaxed text-ink">{m.text}</p>
                          </div>
                        </div>
                      )
                    ))}
                    <div ref={bottomRef} />
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 py-16">
                    <NotebookPen className="size-8 text-ink-faint/30" />
                    <p className="text-sm font-medium text-ink-soft">No questions</p>
                    <p className="text-center text-xs text-ink-faint" style={{ maxWidth: 280 }}>
                      Type a refinement below, or view the draft to approve.
                    </p>
                  </div>
                )}
              </CardContent>
              <ForgeComposer
                value={input}
                onChange={setInput}
                onSubmit={submit}
                disabled={readOnly || isApproved}
                placeholder={isApproved ? 'Approved — revoke to edit' : 'Refine this learning…'}
                secondaryAction={
                  <Button size="sm" variant="secondary" onClick={() => setDraftViews((s) => new Set(s).add(activeId))} leftIcon={<FileText />}>
                    View draft
                  </Button>
                }
              />
            </>
          ) : active ? (
            /* Draft mode — shows the constructed learning content */
            <>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <NotebookPen className="size-4 shrink-0 text-accent" />
                  <CardTitle>{active.text.slice(0, 50)}{active.text.length > 50 ? '…' : ''}</CardTitle>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CATEGORY_STYLE[active.category])}>{active.category}</span>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
                <div className="w-full max-w-xl rounded-[var(--r-md)] border border-line bg-surface p-5 shadow-sm">
                  <p className="text-sm leading-relaxed text-ink">{currentDraft()}</p>
                  <div className="mt-3 flex gap-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CATEGORY_STYLE[active.category])}>{active.category}</span>
                    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-medium text-ink-faint">{active.source}</span>
                  </div>
                </div>
              </CardContent>
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <NotebookPen className="size-5 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{active.text.slice(0, 40)}{active.text.length > 40 ? '…' : ''}</p>
                    <p className="text-xs text-ink-faint">Review the draft, or go back to refine.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setDraftViews((s) => { const n = new Set(s); n.delete(activeId); return n; })} leftIcon={<ChevronLeft />}>
                    Back to conversation
                  </Button>
                  <Button
                    size="sm"
                    onClick={isApproved ? revoke : approve}
                    disabled={readOnly}
                    variant={isApproved ? 'secondary' : 'primary'}
                    leftIcon={isApproved ? <RotateCcw /> : <Check />}
                  >
                    {isApproved ? 'Revoke' : 'Approve'}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </Card>

        {/* RIGHT — learning list rail */}
        <aside className="flex min-h-0 flex-col">
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader>
              <CardTitle>Learnings</CardTitle>
              <span className="text-sm font-medium text-ink-faint">{approvedCount}/{props.learnings.length}</span>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
              {/* Progress bar */}
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-[var(--sage)] transition-all" style={{ width: `${props.learnings.length ? (approvedCount / props.learnings.length) * 100 : 0}%` }} />
              </div>

              {/* Harvesting card */}
              {harvesting && (
                <div className="w-full rounded-[var(--r-md)] border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">Harvesting</span>
                    <Badge variant="neutral" size="sm">running</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin text-accent" />
                    <span className="text-xs text-ink-soft">Extracting learnings…</span>
                  </div>
                </div>
              )}

              {/* Recording card */}
              {recording && (
                <div className="w-full rounded-[var(--r-md)] border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">Recording</span>
                    <Badge variant="neutral" size="sm">running</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin text-accent" />
                    <span className="text-xs text-ink-soft">Writing to journal…</span>
                  </div>
                </div>
              )}

              {/* Learning rows */}
              {props.learnings.map((l) => {
                const isActive = l.id === activeId;
                const approved = l.status === 'kept' || l.status === 'recorded';
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => switchLearning(l.id)}
                    className={cn(
                      'w-full rounded-[var(--r-md)] border px-3 py-2.5 text-left transition-colors',
                      isActive ? 'border-accent bg-surface shadow-sm' : 'border-transparent hover:bg-surface-2/50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {approved ? (
                        <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
                      ) : (
                        <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-surface-2 text-[10px] font-bold text-ink-faint">{l.num}</span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{l.text.slice(0, 60)}{l.text.length > 60 ? '…' : ''}</span>
                      {l.isManual && <span className="text-[9px] text-[var(--sage)]">✎</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CATEGORY_STYLE[l.category])}>{l.category}</span>
                      <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-medium text-ink-faint">{l.source}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium',
                        approved ? 'bg-sage-tint text-[var(--sage-deep)]'
                          : 'bg-surface-2 text-ink-faint',
                      )}>
                        {l.status === 'recorded' ? 'recorded' : approved ? 'approved' : 'ready'}
                      </span>
                      {l.recordedNodeId && (
                        <span className="font-mono text-[10px] text-[var(--sage)]">{l.recordedNodeId}</span>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Add learning button */}
              <button
                type="button"
                onClick={addLearning}
                disabled={readOnly}
                className="flex w-full items-center justify-center gap-1.5 rounded-[var(--r-md)] border border-dashed border-line-strong px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent"
              >
                <Plus className="size-4" /> Add learning
              </button>
            </CardContent>
            <CardFooter className="flex-col !items-stretch gap-2">
              {props.learnings.length === 0 ? (
                <Button className="w-full" onClick={harvest} disabled={readOnly || harvesting} loading={harvesting} leftIcon={<NotebookPen />}>
                  {harvesting ? 'Harvesting…' : 'Harvest learnings'}
                </Button>
              ) : (
                <>
                  <Button className="w-full" onClick={record} disabled={approvedCount === 0 || readOnly || recording} loading={recording} leftIcon={<NotebookPen />}>
                    {recording ? 'Writing…' : `Write ${approvedCount} to journal`}
                  </Button>
                  {approvedCount === 0 && <TextSm className="text-center !text-ink-faint">Approve learnings to enable writing</TextSm>}
                </>
              )}
            </CardFooter>
          </Card>
        </aside>
      </div>
    </div>
  );
}
