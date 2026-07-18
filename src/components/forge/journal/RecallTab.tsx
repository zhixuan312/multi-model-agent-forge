'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Pin,
  MessageCircleQuestion,
  ArrowRight,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardContent, Eyebrow, Spinner, EmptyState } from '@/components/ui';
import { showToast } from '@/components/ui/toast';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { JournalNote } from '@/components/forge/journal/JournalNote';
import { StatusDashboard } from '@/components/patterns/status-dashboard';
import { List, type ListSection } from '@/components/patterns/list';
import { RecallAnswer } from '@/components/forge/journal/RecallView';
import { parseRecallEnvelope, type ParsedRecall } from '@/journal/recall';
import type { IndexLookupRow } from '@/journal/citations';
import type { PinnedView, FaqView } from '@/journal/recall-content';

/**
 * The Recall tab. The 2/3 canvas leads with the live answer (when asked), then
 * the member's pinned Q&A and the team's frequently-asked questions. The rail
 * carries the journal note, then the ask composer below it.
 *
 * Asking POSTs to the recall route and polls the server proxy until terminal
 * (parsed client-side). A completed answer can be pinned (`POST /pins`). A pin
 * is a refreshable cache: it expands in place to its cached answer, shows a
 * "Journal updated since — Refresh" badge when stale, and re-runs the SAME
 * recall dispatch+poll flow on Refresh before persisting the result to the pin
 * route. Clicking a frequent question fills the composer and runs it.
 */

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_INTERVAL_MS = 30_000;
const POLL_CEILING_MS = 5 * 60_000;

type PollResult = { state: 'pending'; headline: string } | { state: 'terminal'; envelope: unknown };

export interface RecentRecall {
  id: string;
  question: string;
  status: string;
  batchId: string | null;
  answerMd?: string;
  findings?: unknown[];
  citationIds?: string[];
  /** True for a client-side entry for a recall the member just ran (not yet reloaded
   *  from the server). Dropped on resync once the recorded row arrives. */
  _optimistic?: boolean;
}

export function RecallTab({
  index,
  pinned,
  faqs,
  recentRecalls = [],
}: {
  index: IndexLookupRow[];
  pinned: PinnedView[];
  faqs: FaqView[];
  recentRecalls?: RecentRecall[];
}) {
  const router = useRouter();
  const onNavigate = (id: string) => router.push(`/journal?view=nodes&node=${id}`);
  const optimistic = useOptimisticAction();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState('');
  const resumedRef = useRef(false);

  // Pinned Q&A — server-loaded initial list, then mutated locally on
  // pin/unpin/refresh so the surface stays responsive without a full reload.
  const [pins, setPins] = useState<PinnedView[]>(pinned);

  // Recent answers = the server-recorded recalls PLUS an optimistic entry for a recall
  // the member just ran, so its answer appears immediately at the top of Recent — NOT as
  // a separate card floating above the pinned answers. The server list is source of
  // truth; the resync drops an optimistic entry once its recorded row shows up (deduped
  // by batchId). Every new recall lands here; pinned answers sit above (PinnedSection).
  const [recents, setRecents] = useState<RecentRecall[]>(recentRecalls);
  const [justAskedKey, setJustAskedKey] = useState<string | null>(null);
  // Depend on a STABLE signature, not the array identity: `recentRecalls` is a fresh
  // array on every render (default prop / server re-render), so keying the effect on the
  // reference would loop. The signature only changes when the recorded list actually does.
  const serverSig = recentRecalls.map((r) => `${r.id}:${r.status}:${r.batchId ?? ''}`).join('|');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile server recents with optimistic local entries when the stable signature changes
    setRecents((local) => {
      const serverKeys = new Set(recentRecalls.map((r) => r.batchId).filter(Boolean));
      const pendingOptimistic = local.filter((r) => r._optimistic && r.batchId && !serverKeys.has(r.batchId));
      return [...pendingOptimistic, ...recentRecalls];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSig]);

  const trimmed = query.trim();
  const canSubmit = trimmed.length >= 10 && trimmed.length <= 4000 && status !== 'running';

  // Completed recent recalls (most recent first)
  const completedRecalls = recents.filter((r) => r.status === 'done' && r.answerMd);
  const hasContent = status !== 'idle' || pins.length > 0 || faqs.length > 0 || completedRecalls.length > 0;

  /** Land a finished recall at the top of Recent (auto-expanded), replacing any prior
   *  entry for the same batch. */
  function addRecent(question: string, result: ParsedRecall, batchId: string) {
    setRecents((prev) => [
      { id: `live-${batchId}`, question, status: 'done', batchId, answerMd: result.summary, findings: result.findings, citationIds: result.citationIds, _optimistic: true },
      ...prev.filter((r) => r.batchId !== batchId),
    ]);
    setJustAskedKey(batchId);
  }

  // Auto-resume: if there's an in-flight recall batch from before page nav, resume
  // polling and land it in Recent when it finishes.
  const inflight = recentRecalls.find((r) => r.status === 'dispatched' || r.status === 'running');
  useEffect(() => {
    if (!inflight?.batchId || resumedRef.current || status === 'running') return;
    resumedRef.current = true;
    setAsked(inflight.question);
    setStatus('running');
    (async () => {
      try {
        const result = await pollUntilTerminal(inflight.batchId!);
        addRecent(inflight.question, result, inflight.batchId!);
        setStatus('idle');
      } catch (e) {
        setError((e as Error).message);
        setStatus('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: resume keys off the inflight batchId only; question/status are read at resume time and adding them would re-fire
  }, [inflight?.batchId]);

  async function pollUntilTerminal(batchId: string): Promise<ParsedRecall> {
    const deadline = Date.now() + POLL_CEILING_MS;
    // Exponential backoff (base 1.5s → cap 30s) under the 5-min hard ceiling — never
    // faster than the base interval, so a slow recall doesn't hammer the row endpoint.
    let delay = POLL_INTERVAL_MS;
    for (;;) {
      if (Date.now() > deadline) throw new Error('Recall timed out — please retry.');
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(Math.round(delay * 1.5), POLL_MAX_INTERVAL_MS);
      const pollRes = await fetch(`/api/journal/recall/${batchId}`);
      if (!pollRes.ok) throw new Error('Journal recall poll failed — please retry.');
      const poll = (await pollRes.json()) as PollResult;
      if (poll.state === 'terminal') {
        const env = poll.envelope as { error?: { message?: string } } | null;
        if (env && env.error && env.error.message) throw new Error(env.error.message);
        return parseRecallEnvelope(poll.envelope);
      }
    }
  }

  async function dispatchAndPoll(q: string): Promise<{ parsed: ParsedRecall; batchId: string }> {
    const dispatch = await fetch('/api/journal/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });
    if (dispatch.status !== 202) {
      throw new Error('Journal recall unavailable — MMA may be restarting.');
    }
    const { batchId } = (await dispatch.json()) as { batchId: string };
    const parsed = await pollUntilTerminal(batchId);
    return { parsed, batchId };
  }

  // Pin any answer (recent OR frequent) — POST /pins, then reflect it in the pinned list.
  async function pinAnswer(question: string, parsed: ParsedRecall) {
    try {
      const res = await fetch('/api/journal/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, answerMd: parsed.summary, findings: parsed.findings, citationIds: parsed.citationIds }),
      });
      if (res.status !== 201) return;
      const created = (await res.json()) as PinnedView;
      setPins((prev) => [created, ...prev]);
      router.refresh();
    } catch { /* best effort */ }
  }
  // Re-run a question's recall and return the fresh answer — a Frequent row's Refresh shows it
  // inline (the recall is recorded server-side, so it also updates the stored FAQ answer + count).
  const runQuestion = (q: string) => dispatchAndPoll(q).then((r) => r.parsed);

  async function run(qRaw?: string) {
    const q = (qRaw ?? query).trim();
    if (q.length < 10 || q.length > 4000) return;
    setStatus('running');
    setError(null);
    setAsked(q);
    try {
      const { parsed, batchId } = await dispatchAndPoll(q);
      addRecent(q, parsed, batchId); // lands in Recent (auto-expanded), not a top card
      setStatus('idle');
      router.refresh(); // reconcile with the server-recorded recall (FAQ counts, etc.)
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }

  async function pinRecent(r: RecentRecall) {
    if (!r.answerMd) return;
    await pinAnswer(r.question, {
      summary: r.answerMd,
      findings: (r.findings ?? []) as ParsedRecall['findings'],
      citationIds: r.citationIds ?? [],
    });
  }

  // Refreshing a recent answer just re-runs the recall — the fresh answer lands as a new
  // entry at the top of Recent (every new call is recorded there), never a top card.
  async function refreshRecent(r: RecentRecall) {
    await run(r.question);
  }

  // One governed List (src/components/patterns/list.tsx). Every section shares the same row
  // contract: the row IS the question, the left chevron expands it, the body is the answer box.
  const recallSections: ListSection[] = [];
  if (pins.length > 0) {
    recallSections.push({
      id: 'pinned',
      header: (<span className="flex items-center gap-1.5"><Pin className="size-3.5" /> Pinned Q&amp;A</span>),
      rows: pins.map((p) => ({
        id: `pin-${p.id}`,
        primary: p.question,
        trailing: p.stale ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--r-sm)] border border-amber bg-amber-tint/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-deep">
            Journal updated since
          </span>
        ) : undefined,
        body: <PinnedBody pin={p} index={index} onNavigate={onNavigate} onRefresh={() => void refreshPin(p)} onUnpin={() => void unpin(p)} />,
      })),
    });
  }
  if (completedRecalls.length > 0) {
    recallSections.push({
      id: 'recent',
      header: (<span className="flex items-center gap-1.5"><Sparkles className="size-3.5" /> Recent answers</span>),
      rows: completedRecalls.map((r) => ({
        id: `recent-${r.id}`,
        primary: r.question,
        defaultOpen: r.batchId != null && r.batchId === justAskedKey,
        body: <RecentBody recall={r} index={index} onNavigate={onNavigate} onRefresh={() => void refreshRecent(r)} onPin={() => void pinRecent(r)} />,
      })),
    });
  }
  if (faqs.length > 0) {
    recallSections.push({
      id: 'frequent',
      header: (<span className="flex items-center gap-1.5"><MessageCircleQuestion className="size-3.5" /> Frequently asked</span>),
      rows: faqs.map((f) => ({
        id: `faq-${f.question}`,
        primary: f.question,
        trailing: (
          <span className="shrink-0 rounded-[var(--r-sm)] bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">{f.count}×</span>
        ),
        body: <FaqBody faq={f} index={index} onNavigate={onNavigate} onRefresh={runQuestion} onPin={pinAnswer} />,
      })),
    });
  }

  return (
    <StatusDashboard
      aside={
        <>
          <JournalNote />
          <RecallComposer
            query={query}
            onChange={setQuery}
            onSubmit={() => void run()}
            canSubmit={canSubmit}
            running={status === 'running'}
            length={trimmed.length}
          />
        </>
      }
      primary={
        // A plain content stack — the Content Shell's left panel (StatusDashboard column) owns
        // the scroll, so a long expanded answer scrolls the panel instead of overflowing it.
        <div className="flex flex-col gap-4">
          {status === 'running' ? (
            <div className="flex items-center gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 px-4 py-3">
              <Spinner className="size-4 text-accent" />
              <span className="truncate text-sm text-ink-soft">
                Recalling — <span className="text-ink">{asked}</span>
              </span>
            </div>
          ) : null}

          {status === 'error' && error ? (
            <p className="rounded-[var(--r-md)] border border-rose bg-rose-tint/40 px-3 py-2 text-sm text-rose">
              {error}
            </p>
          ) : null}

          {hasContent ? (
            <List sections={recallSections} />
          ) : (
            <Card>
              <CardContent className="grid place-items-center py-12">
                <EmptyState
                  icon={<Sparkles />}
                  title="No saved answers yet"
                  description="Ask the journal a question using the composer on the right. Pin useful answers to keep them here for quick access."
                />
              </CardContent>
            </Card>
          )}
        </div>
      }
    />
  );

  // --- pin mutations (closures over the pin state setters) ---

  // Unpin is a reversible inline action → optimistic: the row disappears on click and is
  // re-inserted (at its original position) if the DELETE fails, with an error toast.
  function unpin(p: PinnedView) {
    const index = pins.findIndex((x) => x.id === p.id);
    void optimistic.run({
      apply: () => setPins((prev) => prev.filter((x) => x.id !== p.id)),
      commit: async () => {
        const res = await fetch(`/api/journal/pins/${p.id}`, { method: 'DELETE' });
        // 404 means it's already gone — treat the same as success.
        if (res.status !== 204 && res.status !== 404) throw new Error('Could not unpin.');
      },
      rollback: () =>
        setPins((prev) => {
          if (prev.some((x) => x.id === p.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(index < 0 ? next.length : index, next.length), 0, p);
          return next;
        }),
      error: 'Could not unpin — restored.',
      retryable: true,
    });
  }

  // Refresh a pin: re-run the recall and update THIS pin's cached answer IN PLACE. This is
  // a genuine loading op (the fresh answer is not predictable), so it keeps a per-row busy
  // spinner rather than an optimistic apply; failure surfaces through the toast channel.
  async function refreshPin(p: PinnedView) {
    setPins((prev) => prev.map((x) => (x.id === p.id ? markBusy(x) : x)));
    try {
      const { parsed, batchId } = await dispatchAndPoll(p.question);
      const res = await fetch(`/api/journal/pins/${p.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answerMd: parsed.summary, findings: parsed.findings, citationIds: parsed.citationIds }),
      });
      if (res.status === 404) {
        setPins((prev) => prev.filter((x) => x.id !== p.id));
        return;
      }
      if (!res.ok) throw new Error('Could not refresh this pin.');
      const updated = (await res.json()) as PinnedView;
      setPins((prev) => prev.map((x) => (x.id === p.id ? { ...updated, _busy: undefined } : x)));
      addRecent(p.question, parsed, batchId);
    } catch (e) {
      setPins((prev) => prev.map((x) => (x.id === p.id ? clearBusy(x) : x)));
      showToast({ type: 'error', message: (e as Error).message || 'Could not refresh this pin.' });
    }
  }
}

/** Transient per-pin loading state (the refresh spinner), carried on the row. */
type PinRow = PinnedView & { _busy?: 'refresh' };
function markBusy(p: PinnedView): PinRow {
  return { ...p, _busy: 'refresh' };
}
function clearBusy(p: PinnedView): PinRow {
  return { ...p, _busy: undefined };
}

/** The ask composer — lives in the rail, below the note. */
function RecallComposer({
  query,
  onChange,
  onSubmit,
  canSubmit,
  running,
  length,
}: {
  query: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  running: boolean;
  length: number;
}) {
  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <Eyebrow className="flex shrink-0 items-center gap-1.5 text-ink-faint">
          <Sparkles className="size-3.5" /> Ask the journal
        </Eyebrow>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSubmit();
          }}
          className="mt-2 flex min-h-0 flex-1 flex-col gap-2"
        >
          <label className="sr-only" htmlFor="recall-query">
            Recall query
          </label>
          <textarea
            id="recall-query"
            aria-label="Recall query"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. how should new settings tabs be structured?"
            className="min-h-[8rem] w-full flex-1 resize-none rounded-[var(--r-md)] border border-line bg-surface-2 p-3 text-sm text-ink outline-none focus:border-accent"
          />
          <div className="flex shrink-0 items-center justify-between gap-2">
            <span className="text-xs text-ink-faint">{length}/4000</span>
            <button
              type="submit"
              disabled={!canSubmit}
              className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--r-md)] bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {running ? 'Recalling…' : 'Recall'}
              {!running ? <ArrowRight className="size-4" /> : null}
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** The cached-answer body for a pinned row — the answer box + refresh / unpin actions. */
function PinnedBody({
  pin,
  index,
  onNavigate,
  onRefresh,
  onUnpin,
}: {
  pin: PinRow;
  index: IndexLookupRow[];
  onNavigate: (id: string) => void;
  onRefresh: () => void;
  onUnpin: () => void;
}) {
  const busy = pin._busy;
  return (
    <>
      <RecallAnswer
        parsed={{ summary: pin.answerMd, findings: pin.findings, citationIds: pin.citationIds }}
        index={index}
        onNavigate={onNavigate}
      />
      <div className="mt-3 flex items-center gap-2">
        <RowAction icon={<RefreshCw className={`size-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />} label={busy === 'refresh' ? 'Refreshing…' : 'Refresh'} onClick={onRefresh} disabled={!!busy} tone="accent" />
        <RowAction icon={<Trash2 className="size-3.5" />} label="Unpin" onClick={onUnpin} disabled={!!busy} tone="rose" />
      </div>
    </>
  );
}

/** The cached-answer body for a recent row — the answer box + refresh / pin actions. */
function RecentBody({
  recall,
  index,
  onNavigate,
  onRefresh,
  onPin,
}: {
  recall: RecentRecall;
  index: IndexLookupRow[];
  onNavigate: (id: string) => void;
  onRefresh: () => void;
  onPin: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [pinning, setPinning] = useState(false);
  if (!recall.answerMd) return null;
  return (
    <>
      <RecallAnswer
        parsed={{ summary: recall.answerMd, findings: (recall.findings ?? []) as ParsedRecall['findings'], citationIds: recall.citationIds ?? [] }}
        index={index}
        onNavigate={onNavigate}
      />
      <div className="mt-3 flex items-center gap-2">
        <RowAction icon={<RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />} label={refreshing ? 'Refreshing…' : 'Refresh'} onClick={() => { setRefreshing(true); onRefresh(); }} disabled={refreshing} tone="accent" />
        <RowAction icon={<Pin className="size-3.5" />} label={pinning ? 'Pinned' : 'Pin'} onClick={() => { setPinning(true); onPin(); }} disabled={pinning} tone="accent" />
      </div>
    </>
  );
}

/** The frequent-question body — renders the question's LATEST STORED answer (server-provided
 *  from recall history, so no dispatch on expand), with the same Pin / Refresh actions as a
 *  recent answer. Refresh re-runs the recall and swaps in the fresh answer inline; Pin saves it. */
function FaqBody({
  faq,
  index,
  onNavigate,
  onRefresh,
  onPin,
}: {
  faq: FaqView;
  index: IndexLookupRow[];
  onNavigate: (id: string) => void;
  onRefresh: (question: string) => Promise<ParsedRecall>;
  onPin: (question: string, parsed: ParsedRecall) => Promise<void>;
}) {
  const stored: ParsedRecall | null = faq.answerMd
    ? { summary: faq.answerMd, findings: (faq.findings ?? []) as ParsedRecall['findings'], citationIds: faq.citationIds ?? [] }
    : null;
  const [answer, setAnswer] = useState<ParsedRecall | null>(stored);
  const [refreshing, setRefreshing] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      setAnswer(await onRefresh(faq.question));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      {answer ? (
        <RecallAnswer parsed={answer} index={index} onNavigate={onNavigate} />
      ) : refreshing ? (
        <div className="flex items-center gap-2 py-1 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" /> Recalling…
        </div>
      ) : (
        <p className="text-sm text-ink-faint">No stored answer yet — Refresh to run this question.</p>
      )}
      {error ? (
        <p className="mt-2 rounded-[var(--r-md)] border border-rose bg-rose-tint/40 px-3 py-2 text-sm text-rose">{error}</p>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <RowAction
          icon={<RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
          label={refreshing ? 'Refreshing…' : 'Refresh'}
          onClick={() => void refresh()}
          disabled={refreshing}
          tone="accent"
        />
        <RowAction
          icon={<Pin className="size-3.5" />}
          label={pinning ? 'Pinned' : 'Pin'}
          onClick={() => { setPinning(true); if (answer) void onPin(faq.question, answer); }}
          disabled={pinning || !answer}
          tone="accent"
        />
      </div>
    </>
  );
}

/** The shared inline row action (Refresh / Unpin / Pin) used inside every expanded body. */
function RowAction({
  icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone: 'accent' | 'rose';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'focus-ring inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-2 py-1 text-xs font-medium text-ink-soft disabled:opacity-60',
        tone === 'rose' ? 'hover:border-rose hover:text-rose' : 'hover:border-accent hover:text-accent-deep',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
