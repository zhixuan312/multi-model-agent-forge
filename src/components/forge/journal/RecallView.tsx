'use client';

import { useState } from 'react';
import { Eyebrow, Mono } from '@/components/ui';
import { Markdown } from '@/components/forge/Markdown';
import { StatusDot } from '@/components/forge/journal/StatusBadge';
import {
  resolveCitations,
  collectFindingCitationIds,
  type IndexLookupRow,
} from '@/journal/citations';
import { parseRecallEnvelope, type ParsedRecall } from '@/journal/recall';
import { cn } from '@/lib/cn';

/**
 * The Recall tab (Spec 6). A composer POSTs the query to the auth-gated recall
 * route (→ `202 {batchId}`), then polls the server-side proxy until terminal and
 * parses the envelope CLIENT-SIDE (`parseRecallEnvelope`). The synthesis renders
 * as sanitized markdown with an `mma-journal-recall` chip; each finding carries
 * one deduped id chip per distinct citation node; a Sources list resolves cited
 * ids to title + status against the in-page index (no extra round-trip — F20).
 *
 * On a dispatch/poll failure the query is RETAINED in the composer for retry.
 */

const POLL_INTERVAL_MS = 1500;
const POLL_CEILING_MS = 5 * 60_000; // recall is tens of seconds; generous ceiling

type PollResult =
  | { state: 'pending'; headline: string }
  | { state: 'terminal'; envelope: unknown };

export function RecallView({
  index,
  onNavigate,
}: {
  index: IndexLookupRow[];
  onNavigate: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRecall | null>(null);

  const trimmed = query.trim();
  const canSubmit = trimmed.length >= 10 && trimmed.length <= 4000 && status !== 'running';

  async function run() {
    setStatus('running');
    setError(null);
    setParsed(null);
    try {
      const dispatch = await fetch('/api/journal/recall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
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
          if (env && env.error && env.error.message) {
            throw new Error(env.error.message);
          }
          setParsed(parseRecallEnvelope(poll.envelope));
          setStatus('done');
          return;
        }
      }
    } catch (e) {
      // Keep the query in the composer for retry (F12).
      setError((e as Error).message);
      setStatus('error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void run();
        }}
        className="flex flex-col gap-2"
      >
        <label className="sr-only" htmlFor="recall-query">
          Recall query
        </label>
        <textarea
          id="recall-query"
          aria-label="Recall query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask the team journal… e.g. how do we gate completion?"
          rows={3}
          className="w-full resize-y rounded-[var(--r-md)] border border-line bg-surface-2 p-3 text-sm text-ink outline-none focus:border-accent"
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-[var(--r-md)] bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {status === 'running' ? 'Recalling…' : 'Recall'}
          </button>
          <span className="text-xs text-ink-faint">{trimmed.length}/4000</span>
        </div>
      </form>

      {status === 'error' && error ? (
        <p className="rounded-[var(--r-md)] border border-rose bg-rose-tint/40 px-3 py-2 text-sm text-rose">
          {error}
        </p>
      ) : null}

      {status === 'done' && parsed ? (
        <RecallAnswer parsed={parsed} index={index} onNavigate={onNavigate} />
      ) : null}
    </div>
  );
}

/** The answer card: synthesis (sanitized) + recall chip + findings + Sources. */
export function RecallAnswer({
  parsed,
  index,
  onNavigate,
}: {
  parsed: ParsedRecall;
  index: IndexLookupRow[];
  onNavigate: (id: string) => void;
}) {
  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-[var(--r-sm)] border border-accent bg-accent-tint px-1.5 py-0.5 text-[11px] font-medium text-accent-deep">
          mma-journal-recall
        </span>
      </div>
      <Markdown>{parsed.summary || '_(no answer)_'}</Markdown>

      {parsed.findings.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {parsed.findings.map((f, i) => {
            const ids = collectFindingCitationIds(f);
            return (
              <li key={i} data-testid={`recall-finding-${i}`} className="text-sm text-ink">
                <span>{f.title}</span>
                {ids.length ? (
                  <span className="ml-2 inline-flex flex-wrap gap-1">
                    {ids.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onNavigate(id)}
                        className="rounded-[var(--r-sm)] border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-ink-soft hover:underline"
                      >
                        {id}
                      </button>
                    ))}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {parsed.citationIds.length > 0 ? (
        <RecallSources ids={parsed.citationIds} index={index} onNavigate={onNavigate} />
      ) : null}
    </div>
  );
}

/** The Sources list: id · status dot · title · → link to the node. */
export function RecallSources({
  ids,
  index,
  onNavigate,
}: {
  ids: string[];
  index: IndexLookupRow[];
  onNavigate: (id: string) => void;
}) {
  const rows = resolveCitations(ids, index);
  if (rows.length === 0) return null;
  return (
    <div data-testid="recall-sources" className="mt-4 border-t border-line pt-3">
      <Eyebrow as="h3" className="text-ink-faint">Sources</Eyebrow>
      <ul className="mt-1 flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-sm">
            <Mono className="!text-[11px] text-ink-faint">{r.id}</Mono>
            {r.status ? <StatusDot status={r.status} /> : null}
            <span className={cn(r.title === '(unknown node)' ? 'italic text-ink-faint' : 'text-ink')}>
              {r.title}
            </span>
            <button
              type="button"
              onClick={() => onNavigate(r.id)}
              className="ml-auto text-xs text-accent hover:underline"
              aria-label={`Open node ${r.id}`}
            >
              →
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
