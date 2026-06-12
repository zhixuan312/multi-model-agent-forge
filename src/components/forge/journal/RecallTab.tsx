'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Pin, MessageCircleQuestion, ArrowRight } from 'lucide-react';
import { Card, CardContent, Eyebrow, Spinner } from '@/components/ui';
import { Markdown } from '@/components/forge/Markdown';
import { JournalNote } from '@/components/forge/journal/JournalNote';
import { RailLayout } from '@/components/forge/journal/journal-shell';
import { RecallAnswer } from '@/components/forge/journal/RecallView';
import { parseRecallEnvelope, type ParsedRecall } from '@/journal/recall';
import type { IndexLookupRow } from '@/journal/citations';
import type { PinnedQA, FaqItem } from '@/journal/recall-content';

/**
 * The Recall tab. The 2/3 canvas leads with the live answer (when asked), then
 * the user's pinned Q&A and the team's frequently-asked questions. The rail
 * carries the journal note, then the ask composer below it. Asking POSTs to the
 * recall route and polls the server proxy until terminal (parsed client-side);
 * clicking a frequent question fills the composer and runs it.
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
  pinned: PinnedQA[];
  faqs: FaqItem[];
}) {
  const router = useRouter();
  const onNavigate = (id: string) => router.push(`/journal?view=nodes&node=${id}`);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRecall | null>(null);
  const [asked, setAsked] = useState('');

  const trimmed = query.trim();
  const canSubmit = trimmed.length >= 10 && trimmed.length <= 4000 && status !== 'running';

  async function run(qRaw?: string) {
    const q = (qRaw ?? query).trim();
    if (q.length < 10 || q.length > 4000) return;
    setStatus('running');
    setError(null);
    setParsed(null);
    setAsked(q);
    try {
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
          setParsed(parseRecallEnvelope(poll.envelope));
          setStatus('done');
          return;
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }

  function askFaq(q: string) {
    setQuery(q);
    void run(q);
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
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-4">
        {status === 'running' ? (
          <Card>
            <CardContent className="flex items-center gap-3">
              <Spinner className="size-4 text-accent" />
              <span className="truncate text-sm text-ink-soft">
                Recalling — <span className="text-ink">{asked}</span>
              </span>
            </CardContent>
          </Card>
        ) : null}

        {status === 'error' && error ? (
          <p className="rounded-[var(--r-md)] border border-rose bg-rose-tint/40 px-3 py-2 text-sm text-rose">
            {error}
          </p>
        ) : null}

        {status === 'done' && parsed ? (
          <section className="flex flex-col gap-2">
            <Eyebrow className="flex items-center gap-1.5 text-accent-deep">
              <Sparkles className="size-3.5" /> Answer
            </Eyebrow>
            <RecallAnswer parsed={parsed} index={index} onNavigate={onNavigate} />
          </section>
        ) : null}

        <PinnedSection pinned={pinned} onNavigate={onNavigate} />
        <FaqSection faqs={faqs} onAsk={askFaq} disabled={status === 'running'} />
        </div>
      </div>
    </RailLayout>
  );
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

/** The user's pinned Q&A. */
function PinnedSection({ pinned, onNavigate }: { pinned: PinnedQA[]; onNavigate: (id: string) => void }) {
  if (pinned.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow className="flex items-center gap-1.5 text-ink-faint">
        <Pin className="size-3.5" /> Pinned Q&amp;A
      </Eyebrow>
      <div className="flex flex-col gap-3">
        {pinned.map((p) => (
          <Card key={p.id}>
            <CardContent>
              <p className="text-sm font-semibold text-ink">{p.question}</p>
              <Markdown className="mt-1.5 prose-p:my-1 prose-p:text-sm prose-p:leading-relaxed prose-p:text-ink-soft prose-strong:text-ink prose-code:rounded prose-code:bg-accent-tint/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.78rem] prose-code:font-medium prose-code:text-accent-deep prose-code:before:content-none prose-code:after:content-none">
                {p.answer}
              </Markdown>
              {p.citationIds.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-ink-faint">Sources:</span>
                  {p.citationIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onNavigate(id)}
                      className="focus-ring rounded-[var(--r-sm)] border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft hover:border-accent hover:text-accent-deep"
                    >
                      {id}
                    </button>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
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
  faqs: FaqItem[];
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
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onAsk(f.question)}
                  disabled={disabled}
                  className="focus-ring group flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-soft hover:bg-surface-2 disabled:opacity-50"
                >
                  <Sparkles className="size-3.5 shrink-0 text-ink-faint group-hover:text-accent" />
                  <span className="min-w-0 flex-1">{f.question}</span>
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
