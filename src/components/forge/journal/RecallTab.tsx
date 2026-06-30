'use client';

import { useState } from 'react';
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
const POLL_CEILING_MS = 5 * 60_000;

type PollResult = { state: 'pending'; headline: string } | { state: 'terminal'; envelope: unknown };

export function RecallTab({
  index,
  pinned,
  faqs,
}: {
  index: IndexLookupRow[];
  pinned: PinnedView[];
  faqs: FaqView[];
}) {
  const router = useRouter();
  const onNavigate = (id: string) => router.push(`/journal?view=nodes&node=${id}`);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRecall | null>(null);
  const [asked, setAsked] = useState('');

  // Pinned Q&A — server-loaded initial list, then mutated locally on
  // pin/unpin/refresh so the surface stays responsive without a full reload.
  const [pins, setPins] = useState<PinnedView[]>(pinned);
  const [livePinState, setLivePinState] = useState<'idle' | 'saving' | 'pinned'>('idle');
  const [livePinError, setLivePinError] = useState<string | null>(null);

  const trimmed = query.trim();
  const canSubmit = trimmed.length >= 10 && trimmed.length <= 4000 && status !== 'running';
  const hasContent = status !== 'idle' || pins.length > 0 || faqs.length > 0;

  /** Dispatch a recall and poll the proxy until terminal; resolves to the parsed
   * answer or throws. Shared by the composer and by per-pin Refresh. */
  async function dispatchAndPoll(q: string): Promise<ParsedRecall> {
    const dispatch = await fetch('/api/journal/recall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });
    if (dispatch.status !== 202) {
      throw new Error('Journal recall unavailable — MMA may be restarting.');
    }
    const { batchId } = (await dispatch.json()) as { batchId: string };

    const deadline = Date.now() + POLL_CEILING_MS;
    for (;;) {
      if (Date.now() > deadline) throw new Error('Recall timed out — please retry.');
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
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

  async function run(qRaw?: string) {
    const q = (qRaw ?? query).trim();
    if (q.length < 10 || q.length > 4000) return;
    setStatus('running');
    setError(null);
    setParsed(null);
    setAsked(q);
    setLivePinState('idle');
    setLivePinError(null);
    try {
      const result = await dispatchAndPoll(q);
      setParsed(result);
      setStatus('done');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }

  function askFaq(q: string) {
    setQuery(q);
    void run(q);
  }

  /** Pin the live answer card. The server stamps the freshness marker. */
  async function pinLiveAnswer() {
    if (!parsed || livePinState !== 'idle') return;
    setLivePinState('saving');
    setLivePinError(null);
    try {
      const res = await fetch('/api/journal/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: asked,
          answerMd: parsed.summary,
          findings: parsed.findings,
          citationIds: parsed.citationIds,
        }),
      });
      if (res.status !== 201) throw new Error('Could not pin this answer.');
      const created = (await res.json()) as PinnedView;
      setPins((prev) => [created, ...prev]);
      setLivePinState('pinned');
    } catch (e) {
      setLivePinError((e as Error).message);
      setLivePinState('idle');
    }
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

              {status === 'done' && parsed ? (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Eyebrow className="flex items-center gap-1.5 text-accent-deep">
                      <Sparkles className="size-3.5" /> Answer
                    </Eyebrow>
                    <button
                      type="button"
                      onClick={() => void pinLiveAnswer()}
                      disabled={livePinState !== 'idle'}
                      aria-label="Pin this answer"
                      className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-2 py-1 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent-deep disabled:opacity-60"
                    >
                      <Pin className="size-3.5" />
                      {livePinState === 'pinned' ? 'Pinned' : livePinState === 'saving' ? 'Pinning…' : 'Pin'}
                    </button>
                  </div>
                  {livePinError ? <p className="text-xs text-rose">{livePinError}</p> : null}
                  <RecallAnswer parsed={parsed} index={index} onNavigate={onNavigate} />
                </section>
              ) : null}

              <PinnedSection
                pins={pins}
                index={index}
                onNavigate={onNavigate}
                onUnpin={(p) => void unpin(p)}
                onRefresh={(p) => void refreshPin(p)}
              />
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

  async function refreshPin(p: PinnedView) {
    setPins((prev) => prev.map((x) => (x.id === p.id ? markBusy(x, 'refresh') : x)));
    try {
      const result = await dispatchAndPoll(p.question);
      const res = await fetch(`/api/journal/pins/${p.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answerMd: result.summary, findings: result.findings, citationIds: result.citationIds }),
      });
      if (res.status === 404) {
        setPins((prev) => prev.filter((x) => x.id !== p.id));
        return;
      }
      if (!res.ok) throw new Error('Could not refresh this pin.');
      const updated = (await res.json()) as PinnedView;
      setPins((prev) => prev.map((x) => (x.id === p.id ? { ...updated, _busy: undefined, _error: undefined } : x)));
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
      <div className="flex flex-col gap-3">
        {pins.map((p) => {
          const isOpen = expanded.has(p.id);
          const panelId = `pin-panel-${p.id}`;
          const busy = p._busy;
          return (
            <Card key={p.id}>
              <CardContent className="p-0">
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="focus-ring flex w-full items-center gap-2 px-4 py-3 text-left"
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
                  <div id={panelId} className="border-t border-line px-4 py-3">
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
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/** The team's frequently-asked questions — each runs a recall on click. */
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
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-line">
            {faqs.map((f) => (
              <li key={f.question}>
                <button
                  type="button"
                  onClick={() => onAsk(f.question)}
                  disabled={disabled}
                  className="focus-ring group flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-soft hover:bg-surface-2 disabled:opacity-50"
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
        </CardContent>
      </Card>
    </section>
  );
}
