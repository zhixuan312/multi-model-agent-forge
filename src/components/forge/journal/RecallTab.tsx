'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Pin,
  MessageCircleQuestion,
  ArrowRight,
  ChevronRight,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, Eyebrow, Spinner, EmptyState } from '@/components/ui';
import { JournalNote } from '@/components/forge/journal/JournalNote';
import { RailLayout } from '@/components/forge/journal/journal-shell';
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

  function askFaq(q: string) {
    setQuery(q);
    void run(q);
  }

  async function pinRecent(r: RecentRecall) {
    if (!r.answerMd) return;
    try {
      const res = await fetch('/api/journal/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: r.question,
          answerMd: r.answerMd,
          findings: r.findings ?? [],
          citationIds: r.citationIds ?? [],
        }),
      });
      if (res.status !== 201) return;
      const created = (await res.json()) as PinnedView;
      setPins((prev) => [created, ...prev]);
      router.refresh();
    } catch { /* best effort */ }
  }

  // Refreshing a recent answer just re-runs the recall — the fresh answer lands as a new
  // entry at the top of Recent (every new call is recorded there), never a top card.
  async function refreshRecent(r: RecentRecall) {
    await run(r.question);
  }

  return (
    <RailLayout
      rail={
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
    >
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {hasContent ? (
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

              <PinnedSection
                pins={pins}
                index={index}
                onNavigate={onNavigate}
                onUnpin={(p) => void unpin(p)}
                onRefresh={(p) => void refreshPin(p)}
              />

              {completedRecalls.length > 0 ? (
                <RecentSection recalls={completedRecalls} index={index} autoExpandKey={justAskedKey} onNavigate={onNavigate} onPin={pinRecent} onRefresh={refreshRecent} />
              ) : null}

              <FaqSection faqs={faqs} onAsk={askFaq} disabled={status === 'running'} />
            </div>
          ) : (
            <EmptyState
              icon={<Sparkles />}
              title="No saved answers yet"
              description="Ask the journal a question using the composer on the right. Pin useful answers to keep them here for quick access."
            />
          )}
        </CardContent>
      </Card>
    </RailLayout>
  );

  // --- pin mutations (closures over the pin state setters) ---

  async function unpin(p: PinnedView) {
    setPins((prev) => prev.map((x) => (x.id === p.id ? markBusy(x, 'unpin') : x)));
    const res = await fetch(`/api/journal/pins/${p.id}`, { method: 'DELETE' });
    // 404 means it's already gone — treat the same as success and drop it.
    if (res.status === 204 || res.status === 404) {
      setPins((prev) => prev.filter((x) => x.id !== p.id));
      return;
    }
    setPins((prev) => prev.map((x) => (x.id === p.id ? clearBusy(x, 'Could not unpin.') : x)));
  }

  // Refresh a pin: re-run the recall and update THIS pin's cached answer IN PLACE. The
  // fresh answer never renders as a card above the pin; the recall is also recorded, so
  // it lands in Recent like any other call.
  async function refreshPin(p: PinnedView) {
    setPins((prev) => prev.map((x) => (x.id === p.id ? markBusy(x, 'refresh') : x)));
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
      setPins((prev) => prev.map((x) => (x.id === p.id ? { ...updated, _busy: undefined, _error: undefined } : x)));
      addRecent(p.question, parsed, batchId);
    } catch (e) {
      setPins((prev) => prev.map((x) => (x.id === p.id ? clearBusy(x, (e as Error).message) : x)));
    }
  }
}

/** Transient per-pin UI state, carried on the row without a separate map. */
type PinRow = PinnedView & { _busy?: 'refresh' | 'unpin'; _error?: string };
function markBusy(p: PinnedView, kind: 'refresh' | 'unpin'): PinRow {
  return { ...p, _busy: kind, _error: undefined };
}
function clearBusy(p: PinnedView, error: string): PinRow {
  return { ...p, _busy: undefined, _error: error };
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

/** The member's pinned Q&A — each row expands in place to its cached answer. */
function PinnedSection({
  pins,
  index,
  onNavigate,
  onUnpin,
  onRefresh,
}: {
  pins: PinRow[];
  index: IndexLookupRow[];
  onNavigate: (id: string) => void;
  onUnpin: (p: PinnedView) => void;
  onRefresh: (p: PinnedView) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (pins.length === 0) return null;
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="flex flex-col gap-2">
      <Eyebrow className="flex items-center gap-1.5 text-ink-faint">
        <Pin className="size-3.5" /> Pinned Q&amp;A
      </Eyebrow>
      <div className="flex flex-col divide-y divide-line">
        {pins.map((p) => {
          const isOpen = expanded.has(p.id);
          const panelId = `pin-panel-${p.id}`;
          const busy = p._busy;
          return (
            <div key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className="focus-ring flex w-full items-center gap-2 py-3 text-left"
              >
                <ChevronRight
                  className={`size-4 shrink-0 text-ink-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
                <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{p.question}</span>
                {p.stale ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--r-sm)] border border-amber bg-amber-tint/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-deep">
                    Journal updated since
                  </span>
                ) : null}
              </button>

              {isOpen ? (
                <div id={panelId} className="pb-3 pl-6">
                  <RecallAnswer
                    parsed={{ summary: p.answerMd, findings: p.findings, citationIds: p.citationIds }}
                    index={index}
                    onNavigate={onNavigate}
                  />
                  {p._error ? <p className="mt-2 text-xs text-rose">{p._error}</p> : null}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onRefresh(p)}
                        disabled={!!busy}
                        className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-2 py-1 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent-deep disabled:opacity-60"
                      >
                        <RefreshCw className={`size-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
                        {busy === 'refresh' ? 'Refreshing…' : 'Refresh'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onUnpin(p)}
                        disabled={!!busy}
                        aria-label="Unpin this answer"
                        className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-2 py-1 text-xs font-medium text-ink-soft hover:border-rose hover:text-rose disabled:opacity-60"
                      >
                        <Trash2 className="size-3.5" />
                        {busy === 'unpin' ? 'Removing…' : 'Unpin'}
                      </button>
                    </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The team's frequently-asked questions — each runs a recall on click. */
function RecentSection({
  recalls,
  index,
  autoExpandKey,
  onNavigate,
  onPin,
  onRefresh,
}: {
  recalls: RecentRecall[];
  index: IndexLookupRow[];
  autoExpandKey?: string | null;
  onNavigate: (id: string) => void;
  onPin: (r: RecentRecall) => void;
  onRefresh: (r: RecentRecall) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pinning, setPinning] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  // Auto-expand the recall the member just ran (matched by batchId) so its answer is
  // visible immediately without a click.
  useEffect(() => {
    if (!autoExpandKey) return;
    const match = recalls.find((r) => r.batchId === autoExpandKey);
    if (match) setExpanded((prev) => (prev.has(match.id) ? prev : new Set(prev).add(match.id)));
  }, [autoExpandKey, recalls]);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="flex flex-col gap-2">
      <Eyebrow className="flex items-center gap-1.5 text-ink-faint">
        <Sparkles className="size-3.5" /> Recent answers
      </Eyebrow>
      <div className="flex flex-col divide-y divide-line">
        {recalls.map((r) => {
          const isOpen = expanded.has(r.id);
          return (
            <div key={r.id}>
              <button
                type="button"
                onClick={() => toggle(r.id)}
                aria-expanded={isOpen}
                className="focus-ring flex w-full items-center gap-2 py-3 text-left"
              >
                <ChevronRight
                  className={`size-4 shrink-0 text-ink-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
                <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{r.question}</span>
              </button>
              {isOpen && r.answerMd ? (
                <div className="pb-3 pl-6">
                  <RecallAnswer
                    parsed={{ summary: r.answerMd, findings: (r.findings ?? []) as ParsedRecall['findings'], citationIds: (r.citationIds ?? []) }}
                    index={index}
                    onNavigate={onNavigate}
                  />
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRefreshing((prev) => new Set(prev).add(r.id));
                        onRefresh(r);
                      }}
                      disabled={refreshing.has(r.id)}
                      className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-2 py-1 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent-deep disabled:opacity-60"
                    >
                      <RefreshCw className={`size-3.5 ${refreshing.has(r.id) ? 'animate-spin' : ''}`} />
                      {refreshing.has(r.id) ? 'Refreshing…' : 'Refresh'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPinning((prev) => new Set(prev).add(r.id));
                        onPin(r);
                      }}
                      disabled={pinning.has(r.id)}
                      className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-2 py-1 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent-deep disabled:opacity-60"
                    >
                      <Pin className="size-3.5" />
                      {pinning.has(r.id) ? 'Pinned' : 'Pin'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FaqSection({
  faqs,
  onAsk,
  disabled,
}: {
  faqs: FaqView[];
  onAsk: (q: string) => void;
  disabled: boolean;
}) {
  if (faqs.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow className="flex items-center gap-1.5 text-ink-faint">
        <MessageCircleQuestion className="size-3.5" /> Frequently asked
      </Eyebrow>
      <ul className="flex flex-col divide-y divide-line">
        {faqs.map((f) => (
          <li key={f.question}>
            <button
              type="button"
              onClick={() => onAsk(f.question)}
              disabled={disabled}
              className="focus-ring group flex w-full items-center gap-2 py-3 text-left text-sm text-ink-soft hover:text-ink disabled:opacity-50"
            >
              <Sparkles className="size-3.5 shrink-0 text-ink-faint group-hover:text-accent" />
              <span className="min-w-0 flex-1">{f.question}</span>
              <span className="shrink-0 rounded-[var(--r-sm)] bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
                {f.count}×
              </span>
              <ArrowRight className="size-4 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
