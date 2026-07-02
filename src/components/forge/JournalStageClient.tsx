'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMmaDispatch } from '@/hooks/useMmaDispatch';
import {
  ArrowRight,
  Check,
  Loader2,
  Lock,
  NotebookPen,
  RotateCcw,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { AutomationBar } from '@/components/forge/AutomationBar';
import { SummaryPhase } from '@/components/forge/SummaryPhase';
import { ForgeMark } from '@/components/forge/ForgeMark';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Micro,
} from '@/components/ui';
import { ProseBlock } from '@/components/patterns/prose-block';
import { ConversationComposer } from '@/components/patterns/conversation';
import { RailNote } from '@/components/patterns/feature-rail';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import type { LearningCategory, LearningSource } from '@/journal/types';

const JOURNAL_NOTE = `### Journal — capture team knowledge

- **Harvest** — Forge extracts learnings from all stages
- **Curate** — review, refine, approve or remove
- **Record** — approved learnings are saved to the team journal`;

/* ── Types ─────────────────────────────────────────────────────── */

export interface JournalLearningView {
  id: string;
  num: number;
  title: string;
  body: string;
  category: LearningCategory;
  source: LearningSource;
  status: 'proposed' | 'kept' | 'recorded';
  isManual: boolean;
  recordedNodeId?: string | null;
}

export interface JournalStageClientProps {
  projectId: string;
  projectName: string;
  learnings: JournalLearningView[];
  journalMd: string;
  hasJournalFile: boolean;
  harvesting: boolean;
  recording: boolean;
  activeLearningId?: string;
  currentMember?: { id: string; displayName: string; avatarTint: string };
  summary?: import('@/projects/project-summary').ProjectSummary;
  initialPhase?: 'journal' | 'summary';
  readOnly?: boolean;
}

type LearningStatus = 'proposed' | 'kept' | 'recorded';
type Msg = { id: string; role: 'forge' | 'user'; text: string };

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

/* ── Chat bubbles (matching Plan Refine) ──────────────────────── */

function ChatForge({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <ForgeMark className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="mb-1"><span className="text-xs font-semibold text-ink">Forge</span></div>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-sm">
          <p className="text-sm leading-relaxed text-ink">{children}</p>
        </div>
      </div>
    </div>
  );
}

function ChatUser({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-2.5">
      <div className="max-w-[80%]">
        <span className="mb-1 text-[11px] text-ink-faint">You</span>
        <div className="rounded-2xl rounded-tr-md border border-accent/20 bg-accent-tint px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          {text}
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────── */

export function JournalStageClient(props: JournalStageClientProps) {
  const router = useRouter();
  const readOnly = props.readOnly ?? false;

  type ReflectPhase = 'journal' | 'summary';
  const allRecordedInit = props.learnings.length > 0 && props.learnings.every((l) => l.status === 'recorded');
  const derivedPhase: ReflectPhase = allRecordedInit && props.summary ? 'summary' : 'journal';
  const [phase, setPhaseRaw] = useState<ReflectPhase>(props.initialPhase ?? derivedPhase);
  const setPhase = (p: ReflectPhase) => {
    setPhaseRaw(p);
    const url = new URL(window.location.href);
    url.searchParams.set('phase', p);
    router.push(url.pathname + url.search, { scroll: false });
  };
  const advancePhase = async (p: ReflectPhase) => {
    await fetch(`/api/projects/${props.projectId}/phase`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'journal', phase: p }),
    }).catch(() => {});
    setPhase(p);
  };

  useEffect(() => { stagePhaseStore.set(phase); }, [phase]);
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'journal') setPhaseRaw('journal');
        if (key === 'summary' && allRecordedInit && props.summary) setPhaseRaw('summary');
      }),
    [allRecordedInit, props.summary],
  );

  const [activeId, setActiveId] = useState<string>(props.activeLearningId ?? props.learnings[0]?.id ?? '');
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState('');
  const [viewOverride, setViewOverride] = useState<Record<string, 'content' | 'discussion'>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => { router.refresh(); }, [router]);
  const mma = useMmaDispatch(props.projectId, {
    onDone: {
      'journal-harvest': refresh,
      'journal-record': refresh,
      'journal-refine': refresh,
    },
    events: {
      'journal.updated': (data) => {
        window.dispatchEvent(new CustomEvent('journal:updated', { detail: data }));
        refresh();
      },
      'chat.message': (data) => {
        window.dispatchEvent(new CustomEvent('chat:message', { detail: data }));
      },
    },
  });

  const shouldAutoHarvest = !props.hasJournalFile && props.learnings.length === 0 && !props.harvesting;
  const harvesting = props.harvesting || mma.busyHandlers.has('journal-harvest') || shouldAutoHarvest;
  const recording = props.recording || mma.busyHandlers.has('journal-record');

  // Auto-trigger harvest when no journal.md exists (like plan auto-triggers author-plan)
  useEffect(() => {
    if (!shouldAutoHarvest || mma.busyRef.current.has('journal-harvest')) return;
    void mma.dispatch(`/api/projects/${props.projectId}/journal/harvest`, 'journal-harvest', {}).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = props.learnings.find((l) => l.id === activeId);
  const serverStatus = useMemo(
    () => Object.fromEntries(props.learnings.map((l) => [l.id, l.status])),
    [props.learnings],
  );
  const [localOverrides, setLocalOverrides] = useState<Record<string, LearningStatus>>({});
  const prevServerRef = useRef(serverStatus);
  if (prevServerRef.current !== serverStatus) {
    prevServerRef.current = serverStatus;
    if (Object.keys(localOverrides).length > 0) setLocalOverrides({});
  }
  const status: Record<string, LearningStatus> = { ...serverStatus, ...localOverrides };

  const approvedCount = props.learnings.filter((l) => status[l.id] === 'kept' || status[l.id] === 'recorded').length;
  const allApproved = props.learnings.length > 0 && approvedCount === props.learnings.length;
  const allRecorded = props.learnings.length > 0 && props.learnings.every((l) => status[l.id] === 'recorded');
  const isApproved = active ? (status[active.id] === 'kept' || status[active.id] === 'recorded') : false;

  const [refiningLearnings, setRefiningLearnings] = useState<Set<string>>(new Set());
  const msgs = threads[activeId] ?? [];
  const lastMsg = msgs[msgs.length - 1];
  const hasForgeReply = lastMsg?.role === 'forge';
  const learningView = active ? (viewOverride[active.id] ?? (hasForgeReply ? 'discussion' : 'content')) : 'content';
  const setLearningView = (v: 'content' | 'discussion') => {
    if (active) setViewOverride((prev) => ({ ...prev, [active.id]: v }));
  };
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (learningView === 'discussion') {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    } else {
      contentRef.current?.scrollTo?.(0, 0);
    }
  }, [activeId, learningView, threads]);

  // Category groups for right panel
  const categories = useMemo(() => {
    const cats = new Map<string, JournalLearningView[]>();
    for (const l of props.learnings) {
      const arr = cats.get(l.category) ?? [];
      arr.push(l);
      cats.set(l.category, arr);
    }
    return [...cats.entries()];
  }, [props.learnings]);

  function toggleApprove() {
    if (!active) return;
    const approving = !isApproved;
    const next = approving ? 'kept' : 'proposed';
    setLocalOverrides((o) => ({ ...o, [active.id]: next }));
    // Auto-advance to next unapproved learning
    if (approving) {
      const nextStatus = { ...status, [active.id]: 'kept' as const };
      const nextUnapproved = props.learnings.find((l) => nextStatus[l.id] !== 'kept' && nextStatus[l.id] !== 'recorded');
      if (nextUnapproved) setActiveId(nextUnapproved.id);
    }
    fetch(`/api/projects/${props.projectId}/journal/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learningId: active.id, action: approving ? 'approve' : 'revoke' }),
    }).then(() => { setLocalOverrides({}); router.refresh(); }).catch(() => {});
  }

  function send() {
    const text = input.trim();
    if (!text || !active || refiningLearnings.has(active.id)) return;
    setInput('');
    setThreads((th) => ({
      ...th,
      [active.id]: [...(th[active.id] ?? []), { id: nid(), role: 'user', text }],
    }));

    const forgeTagged = /@forge\b/i.test(text);
    if (forgeTagged) {
      const cleanText = text.replace(/@forge\s*/gi, '').trim() || 'Refine this learning based on the discussion.';
      const refineId = active.id;
      setRefiningLearnings((prev) => new Set(prev).add(refineId));
      setLearningView('discussion');
      // TODO: dispatch to journal-refine route when implemented
      // For now, add a placeholder response
      setTimeout(() => {
        setRefiningLearnings((prev) => { const next = new Set(prev); next.delete(refineId); return next; });
        setThreads((th) => ({
          ...th,
          [active.id]: [...(th[active.id] ?? []), { id: nid(), role: 'forge', text: `Noted: "${cleanText}". Refinement will be applied when journal-refine is wired up.` }],
        }));
      }, 500);
    }
  }

  // Authoring / empty states (like Plan Refine)
  if (harvesting && props.learnings.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        <Card className="flex min-h-0 flex-col lg:col-span-2">
          <CardHeader><CardTitle>Learnings</CardTitle></CardHeader>
          <CardContent className="flex min-h-0 flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="size-6 animate-spin text-accent" />
              <p className="text-sm font-medium text-ink">Harvesting learnings from the project run...</p>
              <p className="text-xs text-ink-soft">Forge extracts learnings from all 6 stages. This takes a moment.</p>
            </div>
          </CardContent>
        </Card>
        <aside className="flex min-h-0 flex-col gap-4">
          <RailNote icon={<BookOpen />}>{JOURNAL_NOTE}</RailNote>
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader>
              <CardTitle>Learnings</CardTitle>
              <Button size="sm" disabled leftIcon={<Check />}>Approve all</Button>
            </CardHeader>
            <div className="flex items-center gap-2 border-b border-line px-5 py-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2" />
              <span className="shrink-0 text-xs font-medium text-ink-faint">0/0</span>
            </div>
            <CardContent className="flex min-h-0 flex-1 items-center justify-center">
              <p className="text-xs text-ink-faint">Learnings appear here once harvesting completes.</p>
            </CardContent>
            <CardFooter className="flex-col !items-stretch gap-2">
              <button
                type="button"
                disabled
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--r)] px-4 py-2 text-sm font-medium pointer-events-none cursor-not-allowed bg-ink/30 text-white/50"
              >
                <Lock className="size-4" />
                Record 0 learnings
              </button>
            </CardFooter>
          </Card>
        </aside>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
        <Card className="flex min-h-0 flex-col lg:col-span-2">
          <CardHeader><CardTitle>Learnings</CardTitle></CardHeader>
          <CardContent className="flex min-h-0 flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <NotebookPen className="size-8 text-ink-faint" />
              <p className="text-sm font-medium text-ink">No learnings yet</p>
              <p className="text-xs text-ink-soft">Harvest AI learnings from the project run, or add your own.</p>
              <Button
                size="sm"
                onClick={() => mma.dispatch(`/api/projects/${props.projectId}/journal/harvest`, 'journal-harvest', {})}
                disabled={readOnly || harvesting}
                loading={harvesting}
                leftIcon={<NotebookPen />}
              >
                Harvest learnings
              </Button>
            </div>
          </CardContent>
        </Card>
        <aside className="flex min-h-0 flex-col">
          <RailNote icon={<BookOpen />}>{JOURNAL_NOTE}</RailNote>
        </aside>
      </div>
    );
  }

  const [completing, setCompleting] = useState(false);

  if (phase === 'summary' && props.summary) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <SummaryPhase
          summary={props.summary}
          projectId={props.projectId}
          readOnly={readOnly}
          completing={completing}
          onMarkComplete={() => {
            setCompleting(true);
            fetch(`/api/projects/${props.projectId}/complete`, { method: 'POST' })
              .then(() => router.refresh())
              .catch(() => {})
              .finally(() => setCompleting(false));
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <AutomationBar
        mode="off"
        note=""
        disabled={readOnly}
        idleHint="Capture learnings from this project, or let Forge extract them automatically."
        onRun={() => {}}
        onStop={() => {}}
      />
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* LEFT — learning content / discussion (like Plan Refine) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="neutral" size="sm">Learning {active.num}</Badge>
            <CardTitle>{active.title}</CardTitle>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CATEGORY_STYLE[active.category])}>{active.category}</span>
          </div>
          <div className="flex items-center rounded-[var(--r)] border border-line bg-surface-2 p-0.5">
            {(['content', 'discussion'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setLearningView(v)}
                className={cn(
                  'rounded-[6px] px-3 py-1 text-xs font-medium transition-colors',
                  learningView === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink',
                )}
              >
                {v === 'content' ? 'Content' : 'Discussion'}
              </button>
            ))}
          </div>
        </CardHeader>
        <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto bg-surface-2/40 px-5 py-5">
          {learningView === 'content' ? (
            <ProseBlock className="max-w-none prose-headings:mb-1.5 prose-headings:mt-4 first:prose-headings:mt-0">
              {active.body}
            </ProseBlock>
          ) : (
            <div className="space-y-5">
              {msgs.length === 0 ? (
                <p className="py-8 text-center text-xs text-ink-faint">No discussion yet — type @Forge to refine this learning.</p>
              ) : null}
              {msgs.map((m) => (m.role === 'user' ? <ChatUser key={m.id} text={m.text} /> : <ChatForge key={m.id}>{m.text}</ChatForge>))}
              {active && refiningLearnings.has(active.id) ? (
                <ChatForge>
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin text-accent" /> Thinking…
                  </span>
                </ChatForge>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        {learningView === 'content' ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Button
              size="sm"
              onClick={toggleApprove}
              disabled={readOnly}
              variant={isApproved ? 'secondary' : 'primary'}
              leftIcon={isApproved ? <RotateCcw /> : <Check />}
            >
              {isApproved ? 'Revoke' : 'Approve'}
            </Button>
          </div>
        ) : (
          <ConversationComposer
            value={input}
            onChange={setInput}
            onSend={send}
            placeholder="@Forge to refine this learning..."
            disabled={readOnly || (active != null && refiningLearnings.has(active.id))}
          />
        )}
      </Card>

      {/* RIGHT — learning list grouped by category (like Plan Refine task list) */}
      <aside className="flex min-h-0 flex-col gap-4">
        <RailNote icon={<BookOpen />}>{JOURNAL_NOTE}</RailNote>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Learnings</CardTitle>
            <Button
              size="sm"
              onClick={() => {
                const allKept = approvedCount === props.learnings.length;
                for (const l of props.learnings) {
                  setLocalOverrides((o) => ({ ...o, [l.id]: allKept ? 'proposed' : 'kept' }));
                  fetch(`/api/projects/${props.projectId}/journal/approve`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ learningId: l.id, action: allKept ? 'revoke' : 'approve' }),
                  }).catch(() => {});
                }
                setTimeout(() => { setLocalOverrides({}); router.refresh(); }, 300);
              }}
              disabled={readOnly || props.learnings.length === 0}
              leftIcon={approvedCount === props.learnings.length ? <RotateCcw /> : <Check />}
            >
              {approvedCount === props.learnings.length ? 'Revoke all' : 'Approve all'}
            </Button>
          </CardHeader>
          <div className="flex items-center gap-2 border-b border-line px-5 py-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-[var(--sage)] transition-all" style={{ width: `${props.learnings.length ? (approvedCount / props.learnings.length) * 100 : 0}%` }} />
            </div>
            <span className="shrink-0 text-xs font-medium text-ink-faint">{approvedCount}/{props.learnings.length}</span>
          </div>
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-3">
            {categories.map(([cat, items]) => (
              <div key={cat} className="space-y-2">
                <Micro className="block !font-semibold !uppercase !tracking-wide !text-ink-faint">{cat}</Micro>
                {items.map((l) => {
                  const isActive = l.id === activeId;
                  const approved = status[l.id] === 'kept' || status[l.id] === 'recorded';
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => { setActiveId(l.id); setInput(''); }}
                      className={cn(
                        'flex w-full gap-2.5 rounded-[var(--r-md)] border p-2.5 text-left transition-colors',
                        isActive
                          ? 'border-accent bg-accent-tint/25 shadow-sm'
                          : approved
                            ? 'border-[var(--sage-deep)]/30 bg-sage-tint/20 hover:bg-sage-tint/40'
                            : 'border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      <span className={cn(
                        'mt-0.5 grid size-6 shrink-0 place-items-center rounded-[6px] text-[10px] font-semibold transition-colors',
                        approved ? 'bg-[var(--sage-deep)] text-white'
                          : isActive ? 'bg-accent text-white'
                          : 'bg-surface-2 text-ink-faint',
                      )}>
                        {approved ? <Check className="size-3.5" /> : l.num}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium leading-snug text-ink">{l.title}</p>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-faint">
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold', CATEGORY_STYLE[l.category])}>{l.category}</span>
                          <span>{l.source}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <button
              type="button"
              onClick={() => {
                if (!allRecorded && approvedCount > 0) {
                  mma.dispatch(`/api/projects/${props.projectId}/journal/record`, 'journal-record', {}).catch(() => {});
                }
                advancePhase('summary');
              }}
              disabled={approvedCount === 0 || readOnly || recording}
              className={cn(
                'inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--r)] px-4 py-2 text-sm font-medium transition-colors',
                approvedCount === 0 || recording ? 'pointer-events-none cursor-not-allowed bg-ink/30 text-white/50' : 'bg-accent text-white hover:bg-accent/90',
              )}
            >
              {recording ? <Loader2 className="size-4 animate-spin" /> : null}
              {recording ? 'Recording...' : 'Continue to Summary'}
              {!recording ? <ArrowRight className="size-4" /> : null}
            </button>
          </CardFooter>
        </Card>
      </aside>
    </div>
    </div>
  );
}
