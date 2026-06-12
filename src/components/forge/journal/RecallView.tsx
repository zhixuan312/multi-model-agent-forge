'use client';

import { Eyebrow, Mono } from '@/components/ui';
import { Markdown } from '@/components/forge/Markdown';
import { StatusDot } from '@/components/forge/journal/StatusBadge';
import {
  resolveCitations,
  collectFindingCitationIds,
  type IndexLookupRow,
} from '@/journal/citations';
import type { ParsedRecall } from '@/journal/recall';
import { cn } from '@/lib/cn';

/**
 * The recall answer presentation (Spec 6). The synthesis renders as sanitized
 * markdown with an `mma-journal-recall` chip; each finding carries one deduped id
 * chip per distinct citation node; a Sources list resolves cited ids to title +
 * status against the in-page index (no extra round-trip — F20). The composer that
 * dispatches/polls the recall lives in `RecallTab`.
 */

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
