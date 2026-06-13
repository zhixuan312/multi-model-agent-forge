'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  Plus,
  Sparkles,
  NotebookPen,
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
  Textarea,
  TextSm,
  Micro,
  Eyebrow,
} from '@/components/ui';
import { stagePhaseStore } from '@/components/forge/stage-substeps';
import { AutomationBar, type AutoMode } from '@/components/forge/AutomationBar';
import { StageAdvance } from '@/components/forge/StageAdvance';
import type { ProjectPhase } from '@/db/enums';
import { LEARNING_CATEGORIES, type Learning, type LearningCategory } from '@/mock/domains/projects/journal';

/** A distinct tint per learning category. */
const CATEGORY_STYLE: Record<LearningCategory, string> = {
  decision: 'bg-accent-tint text-accent',
  design: 'bg-[var(--frost)] text-[var(--steel)]',
  behavior: 'bg-sage-tint text-[var(--sage-deep)]',
  process: 'bg-amber-tint text-[var(--amber)]',
  knowledge: 'bg-rose-tint text-[var(--rose)]',
  style: 'bg-surface-2 text-ink-soft',
};

function CategoryChip({ c }: { c: LearningCategory }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CATEGORY_STYLE[c])}>{c}</span>
  );
}

type JournalPhase = 'harvest' | 'curate' | 'record';
interface Msg {
  id: string;
  role: 'forge' | 'user';
  text: string;
}

export interface JournalStageClientProps {
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
  learnings: Learning[];
}

let _id = 0;
const nid = () => `jl${_id++}`;

/**
 * Reframe a raw gist into a generalized, articulated principle — NOT an echo of
 * the user's words. Strips conversational fillers + first-person framing so the
 * entry reads as a reusable learning the AI authored. (The real product runs this
 * through the model with the full journaling frame; this is the mock's stand-in.)
 */
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
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

export function JournalStageClient(props: JournalStageClientProps) {
  const readOnly = props.phase !== 'build' && props.phase !== 'done';
  const [learnings, setLearnings] = useState<Learning[]>(props.learnings);

  const [phase, setPhase] = useState<JournalPhase>('harvest');
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [auto, setAuto] = useState<AutoMode>('off');
  const [autoNote, setAutoNote] = useState('');

  useEffect(() => stagePhaseStore.set(phase), [phase]);
  useEffect(
    () =>
      stagePhaseStore.onNavigate((key) => {
        if (key === 'harvest') setPhase('harvest');
        else if (key === 'curate') setPhase('curate');
        else if (key === 'record' && approved.size > 0) setPhase('record');
      }),
    [approved.size],
  );

  useEffect(() => {
    if (readOnly) return;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      setAutoNote('AI is driving — harvesting the learnings…');
      setAuto('running');
    }
  }, [readOnly]);

  const approvedCount = approved.size;

  // Automated driver: harvest → curate (approve each) → record → complete.
  useEffect(() => {
    if (auto !== 'running' || readOnly || phase === 'record') return;
    const t = setTimeout(() => {
      if (phase === 'harvest') {
        setAutoNote('Harvested ' + learnings.length + ' learnings — curating…');
        setPhase('curate');
      } else if (phase === 'curate') {
        const next = learnings.find((l) => !approved.has(l.id));
        if (next) {
          setAutoNote('Approved: ' + next.text.slice(0, 48) + '…');
          setApproved((s) => new Set(s).add(next.id));
        } else {
          setAutoNote('Recorded ' + approvedCount + ' learnings to the journal — project complete.');
          setPhase('record');
          setAuto('off');
        }
      }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, phase, approved, readOnly]);

  function toggleApprove(id: string) {
    setApproved((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  /** Add a blank learning (drafted by talking to Forge); returns its id. */
  function addLearning(): string {
    const num = learnings.reduce((m, l) => Math.max(m, l.num), 0) + 1;
    const id = `lnew-${num}`;
    setLearnings((ls) => [...ls, { id, num, text: '', tags: [], source: 'Manual', category: 'decision' }]);
    return id;
  }
  function updateLearning(id: string, patch: Partial<Learning>) {
    setLearnings((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="journal-stage">
      <AutomationBar
        mode={auto}
        note={autoNote}
        disabled={readOnly}
        idleHint="Curate the learnings yourself, or let Forge harvest and record them to close out the project."
        runningHint="Forge harvests the run’s learnings, approves the worthwhile ones, and records them. Stop anytime."
        onRun={() => {
          setAutoNote('AI is driving — harvesting the learnings…');
          setAuto('running');
        }}
        onStop={() => {
          setAuto('off');
          setAutoNote('Stopped — you have the wheel.');
        }}
      />

      {phase === 'harvest' ? (
        <HarvestStage learnings={learnings} onCurate={() => setPhase('curate')} />
      ) : phase === 'curate' ? (
        <CurateStage
          learnings={learnings}
          approved={approved}
          approvedCount={approvedCount}
          readOnly={readOnly}
          driving={auto === 'running'}
          onToggleApprove={toggleApprove}
          onAdd={addLearning}
          onUpdate={updateLearning}
          onRecord={() => setPhase('record')}
        />
      ) : (
        <RecordStage projectName={props.projectName} learnings={learnings.filter((l) => approved.has(l.id))} />
      )}
    </div>
  );
}

/* ── Harvest — all gathered learnings (main), summary (right) — Spec-Outline-style ── */
function HarvestStage({ learnings, onCurate }: { learnings: Learning[]; onCurate: () => void }) {
  const sources = [...new Set(learnings.map((l) => l.source))];
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* MAIN — every harvested learning (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <NotebookPen className="size-4 shrink-0 text-accent" />
            <CardTitle>Harvested learnings</CardTitle>
            <Badge variant="neutral" size="sm">
              {learnings.length}
            </Badge>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--frost)] px-2.5 py-1 text-[11px] font-medium text-[var(--steel)]">
            <Sparkles className="size-3" /> from the whole run
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-2.5 overflow-y-auto !py-4">
          {learnings.map((l) => (
            <div key={l.id} className="rounded-[var(--r-md)] border border-line bg-surface px-3.5 py-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-px grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-surface-2 font-mono text-[10px] font-semibold text-ink-soft">
                  {l.num}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm leading-relaxed text-ink">{l.text}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-soft">{l.source}</span>
                    <CategoryChip c={l.category} />
                    {l.tags.map((t) => (
                      <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-faint">#{t}</span>
                    ))}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* RIGHT — summary + move-on (1/3) */}
      <aside className="flex min-h-0 flex-col gap-4">
        <div className="flex shrink-0 items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/30 px-4 py-4">
          <NotebookPen className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0">
            <Eyebrow as="h3" className="text-accent-deep">
              Close the loop
            </Eyebrow>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
              The journal is durable memory across projects. Recording these means the next run starts knowing what this
              one learned.
            </p>
          </div>
        </div>
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-xs text-ink-faint">Learnings</span>
              <span className="text-sm font-semibold text-ink">{learnings.length}</span>
            </div>
            <Micro className="!font-semibold !uppercase !tracking-wide !text-ink-faint">By category</Micro>
            <div className="space-y-1.5">
              {LEARNING_CATEGORIES.filter((c) => learnings.some((l) => l.category === c)).map((c) => (
                <div key={c} className="flex items-center justify-between">
                  <CategoryChip c={c} />
                  <span className="text-sm font-semibold text-ink">{learnings.filter((l) => l.category === c).length}</span>
                </div>
              ))}
            </div>
            <Micro className="!font-semibold !uppercase !tracking-wide !text-ink-faint">By source</Micro>
            <div className="space-y-1.5">
              {sources.map((s) => (
                <div key={s} className="flex items-center justify-between">
                  <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{s}</span>
                  <span className="text-sm font-semibold text-ink">{learnings.filter((l) => l.source === s).length}</span>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={onCurate} rightIcon={<ArrowRight />}>
              Curate the learnings
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/* ── Curate — per-learning conversation + approve (Craft-style) ─────────────── */
function CurateStage({
  learnings,
  approved,
  approvedCount,
  readOnly,
  driving,
  onToggleApprove,
  onAdd,
  onUpdate,
  onRecord,
}: {
  learnings: Learning[];
  approved: Set<string>;
  approvedCount: number;
  readOnly: boolean;
  driving: boolean;
  onToggleApprove: (id: string) => void;
  onAdd: () => string;
  onUpdate: (id: string, patch: Partial<Learning>) => void;
  onRecord: () => void;
}) {
  const firstOpen = learnings.find((l) => !approved.has(l.id)) ?? learnings[0];
  const [activeId, setActiveId] = useState<string>(firstOpen?.id ?? '');
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = learnings.find((l) => l.id === activeId) ?? learnings[0];

  useEffect(() => {
    if (!active || threads[active.id]) return;
    const seed = active.text
      ? `This came from the ${active.source}. I'd record it as-is — it’s a ${active.tags[0] ?? 'general'} learning the next run should know. Want to reword it, add context, or approve?`
      : 'New learning — tell me what happened in your own words. I’ll generalize it into a reusable principle, ground it in this run, and note how to apply it next time.';
    setThreads((th) => ({ ...th, [active.id]: [{ id: nid(), role: 'forge', text: seed }] }));
  }, [active, threads]);
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'end' }), [threads, activeId]);

  // Follow the AI as it auto-approves.
  useEffect(() => {
    if (active && approved.has(active.id)) {
      const next = learnings.find((l) => !approved.has(l.id));
      if (next) setActiveId(next.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved]);

  if (!active) return null;
  const isApproved = approved.has(active.id);
  const msgs = threads[active.id] ?? [];
  const allApproved = approvedCount === learnings.length;

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    const drafting = !active.text; // a new, empty learning being written up
    if (drafting) onUpdate(active.id, { text: frameLearning(text) });
    setThreads((th) => ({
      ...th,
      [active.id]: [
        ...(th[active.id] ?? []),
        { id: nid(), role: 'user', text },
        {
          id: nid(),
          role: 'forge',
          text: drafting
            ? 'Framed it as a reusable principle above — generalized from your note, not a transcript. Tighten the wording, or approve it for the journal.'
            : 'Good — folded that into the entry below. Approve it when it reads right.',
        },
      ],
    }));
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      {/* LEFT — the active learning's full entry + conversation (2/3) */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="neutral" size="sm">
              #{active.num}
            </Badge>
            <CardTitle>Journal entry</CardTitle>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-soft">
              {active.source}
            </span>
            <CategoryChip c={active.category} />
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-surface-2/40 !py-5">
          {/* The full journal entry. */}
          <div className="rounded-[var(--r-md)] border border-line bg-surface p-4">
            {active.text ? (
              <p className="text-[15px] leading-relaxed text-ink">{active.text}</p>
            ) : (
              <p className="text-[15px] italic leading-relaxed text-ink-faint">
                New learning — describe it in the chat below and I’ll write it up here.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
              <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-soft">{active.source}</span>
              <CategoryChip c={active.category} />
              {active.tags.map((t) => (
                <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-faint">#{t}</span>
              ))}
            </div>
          </div>
          {msgs.map((m) => (m.role === 'user' ? <UserBubble key={m.id} text={m.text} /> : <ForgeBubble key={m.id}>{m.text}</ForgeBubble>))}
          <div ref={bottomRef} />
        </CardContent>
        {isApproved ? (
          <CardFooter>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="size-5 shrink-0 text-[var(--sage)]" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Approved for the journal</p>
                <p className="text-xs text-ink-faint">Re-open to revoke and keep discussing, or pick another.</p>
              </div>
            </div>
            <Button variant="secondary" onClick={() => onToggleApprove(active.id)} disabled={readOnly} leftIcon={<ChevronLeft />}>
              Re-open
            </Button>
          </CardFooter>
        ) : (
          <Composer
            value={input}
            onChange={setInput}
            onSend={send}
            secondary={{ label: 'Approve learning', icon: <Check />, onClick: () => onToggleApprove(active.id), disabled: readOnly }}
            placeholder="Discuss this learning — “reword it”, “add the token-delta number”…"
            disabled={readOnly || driving}
          />
        )}
      </Card>

      {/* RIGHT — the harvested learnings list (1/3) */}
      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Harvested</CardTitle>
            <span className="text-sm font-medium text-ink-faint">
              {approvedCount}/{learnings.length}
            </span>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
            <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-[var(--sage)] transition-all" style={{ width: `${learnings.length ? (approvedCount / learnings.length) * 100 : 0}%` }} />
            </div>
            {learnings.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setActiveId(l.id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-[var(--r-md)] border px-3 py-2 text-left transition-colors',
                  l.id === active.id ? 'border-accent bg-surface shadow-sm' : 'border-transparent hover:bg-surface-2/50',
                )}
              >
                {approved.has(l.id) ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--sage)]" />
                ) : (
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-line-strong font-mono text-[9px] text-ink-faint">{l.num}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn('line-clamp-2 text-[13px] leading-snug', l.text ? 'text-ink' : 'italic text-ink-faint')}>
                    {l.text || 'New learning…'}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-faint">{l.source}</span>
                    <CategoryChip c={l.category} />
                  </span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const id = onAdd();
                setActiveId(id);
              }}
              disabled={readOnly}
              className="flex w-full items-center justify-center gap-1.5 rounded-[var(--r-md)] border border-dashed border-line-strong px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-4" /> Add learning
            </button>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={onRecord} disabled={!allApproved} rightIcon={<NotebookPen />}>
              Record {approvedCount} learning{approvedCount === 1 ? '' : 's'}
            </Button>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/* ── Record — written to the journal, project complete ─────────────────────── */
function RecordStage({ projectName, learnings }: { projectName: string; learnings: Learning[] }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardHeader>
          <div className="flex min-w-0 items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-[var(--sage)]" />
            <CardTitle>Recorded to the journal</CardTitle>
            <Badge variant="sage" size="sm">
              {learnings.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto !py-4">
          {learnings.map((l) => (
            <div key={l.id} className="flex items-start gap-2.5 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--sage)]" />
              <span className="min-w-0 flex-1">
                <span className="text-sm leading-relaxed text-ink">{l.text}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-soft">{l.source}</span>
                  <CategoryChip c={l.category} />
                  {l.tags.map((t) => (
                    <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-faint">#{t}</span>
                  ))}
                </span>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <aside className="flex min-h-0 flex-col">
        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <CardTitle>Complete</CardTitle>
            <Badge variant="sage" size="sm">done</Badge>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto !py-4">
            <div className="flex items-start gap-2.5 rounded-[var(--r-md)] border border-sage-tint bg-sage-tint/40 px-3.5 py-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--sage-deep)]" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{projectName} is complete</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                  Explore → Spec → Plan → Execute → Review → Journal. The learnings are now durable memory for the next run.
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex-col !items-stretch gap-2">
            <StageAdvance href="/journal" label="View the journal" />
            <a
              href="/projects"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--r)] border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2"
            >
              Back to projects
            </a>
          </CardFooter>
        </Card>
      </aside>
    </div>
  );
}

/* ── chat primitives ────────────────────────────────────────────────────────── */
function ForgeBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <ForgeMark className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-semibold text-ink">Forge</span>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex flex-row-reverse gap-2.5">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sage-tint text-[11px] font-semibold text-[var(--sage-deep)]">
        AD
      </span>
      <div className="flex min-w-0 max-w-[88%] flex-col items-end">
        <span className="mb-1 text-[11px] text-ink-faint">You</span>
        <div className="rounded-2xl rounded-tr-md border border-accent/20 bg-accent-tint px-4 py-3 text-sm leading-relaxed text-ink shadow-sm">
          {text}
        </div>
      </div>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  secondary,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  secondary?: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean };
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <div className="shrink-0 border-t border-line px-5 py-4">
      <div className="flex gap-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-sage-tint text-[11px] font-semibold text-[var(--sage-deep)]">
          AD
        </span>
        <div className="min-w-0 flex-1">
          <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} disabled={disabled} placeholder={placeholder} className="!min-h-0 !rounded-2xl !text-sm" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {secondary ? (
              <Button size="sm" variant="ghost" onClick={secondary.onClick} disabled={disabled || secondary.disabled} leftIcon={secondary.icon}>
                {secondary.label}
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button size="sm" onClick={onSend} disabled={disabled || !value.trim()} rightIcon={<ArrowRight />}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
