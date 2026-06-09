'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Markdown } from '@/components/forge/Markdown';
import { cn } from '@/lib/cn';
import type { LearningType } from '@/db/enums';

/**
 * `FreezeClient` (Spec 4 Part B / `/freeze`) — the learnings-curation island.
 *
 * Two parts: (1) the freeze confirmation banner (the page is reached AFTER the
 * irreversible freeze — `data-phase` is already cold on the layout), and (2) the
 * `learning_candidate` curation list — editable candidates, keep/remove toggles,
 * an "add your own" affordance, and "Record to journal" which dispatches
 * `journal-record` at the workspace root and stamps each `recorded_node_id`.
 */

export interface LearningCandidateView {
  id: string;
  bodyMd: string;
  type: LearningType;
  status: 'proposed' | 'kept' | 'removed' | 'recorded';
  recordedNodeId: string | null;
}

const TYPES: LearningType[] = ['challenge', 'insight', 'decision'];

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status}).`);
  }
  return res.json() as Promise<T>;
}

export function FreezeClient({
  projectId,
  initialCandidates,
  frozen,
}: {
  projectId: string;
  initialCandidates: LearningCandidateView[];
  frozen: boolean;
}) {
  const [candidates, setCandidates] = useState<LearningCandidateView[]>(initialCandidates);
  const [error, setError] = useState<string | null>(null);
  const [newType, setNewType] = useState<LearningType>('insight');
  const [newBody, setNewBody] = useState('');

  // Ensure the candidate set exists on first load (idempotent propose).
  const propose = useMutation({
    mutationFn: () => send<{ candidates: LearningCandidateView[] }>(`/projects/${projectId}/spec/learnings`, 'POST'),
    onSuccess: (data) => setCandidates(data.candidates),
    onError: (e: Error) => setError(e.message),
  });
  useEffect(() => {
    if (initialCandidates.length === 0) propose.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = useMutation({
    mutationFn: (vars: { id: string; status: 'kept' | 'removed' }) =>
      send<{ candidates: LearningCandidateView[] }>(`/projects/${projectId}/spec/learnings/${vars.id}`, 'PATCH', {
        status: vars.status,
      }),
    onSuccess: (data) => {
      setError(null);
      setCandidates(data.candidates);
    },
    onError: (e: Error) => setError(e.message),
  });

  const add = useMutation({
    mutationFn: (vars: { bodyMd: string; type: LearningType }) =>
      send<{ candidates: LearningCandidateView[] }>(`/projects/${projectId}/spec/learnings/add`, 'POST', vars),
    onSuccess: (data) => {
      setError(null);
      setCandidates(data.candidates);
      setNewBody('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const commit = useMutation({
    mutationFn: () =>
      send<{ recordedCount: number; candidates: LearningCandidateView[] }>(
        `/projects/${projectId}/spec/learnings/commit`,
        'POST',
      ),
    onSuccess: (data) => {
      setError(null);
      setCandidates(data.candidates);
    },
    onError: (e: Error) => setError(e.message),
  });

  const allRecorded = candidates.length > 0 && candidates.every((c) => c.status === 'recorded');
  const keptCount = candidates.filter((c) => c.status === 'kept').length;

  return (
    <div className="flex flex-col gap-5" data-testid="freeze-screen">
      <div
        className="rounded-[var(--r-md)] border border-line bg-surface p-4"
        data-testid="freeze-banner"
        data-frozen={frozen ? 'true' : 'false'}
      >
        <h2 className="font-serif text-lg text-ink">
          {frozen ? 'Specification frozen' : 'Freeze the specification'}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {frozen
            ? 'The spec is frozen — this is a point of no return. The project has moved into the Build phase.'
            : 'Freezing is irreversible. Once frozen, the spec is read-only and the project enters Build.'}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-medium text-ink">Learnings to record</h3>
          {propose.isPending ? <span className="text-xs text-ink-faint">Proposing…</span> : null}
        </div>
        <p className="text-sm text-ink-muted">
          Curate what this project figured out and what was hard. Only kept learnings are written to the team
          journal.
        </p>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <ul className="flex flex-col gap-2" data-testid="learning-list">
          {candidates.map((c) => (
            <li
              key={c.id}
              data-testid="learning-card"
              data-status={c.status}
              className={cn(
                'flex flex-col gap-2 rounded-[var(--r-md)] border border-line bg-surface p-3',
                c.status === 'removed' ? 'opacity-50' : null,
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium uppercase text-ink-muted">
                  {c.type}
                </span>
                {c.status === 'recorded' ? (
                  <span className="text-[11px] text-sage-deep">recorded · {c.recordedNodeId}</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: c.id, status: 'kept' })}
                      aria-pressed={c.status === 'kept'}
                      className={cn(
                        'rounded px-2 py-0.5 text-xs',
                        c.status === 'kept' ? 'bg-sage-tint text-sage-deep' : 'bg-surface-2 text-ink-muted',
                      )}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: c.id, status: 'removed' })}
                      aria-pressed={c.status === 'removed'}
                      className={cn(
                        'rounded px-2 py-0.5 text-xs',
                        c.status === 'removed' ? 'bg-rose-100 text-rose-700' : 'bg-surface-2 text-ink-muted',
                      )}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              <div className="text-sm text-ink">
                <Markdown>{c.bodyMd}</Markdown>
              </div>
            </li>
          ))}
        </ul>

        {!allRecorded ? (
          <div className="flex flex-col gap-2 rounded-[var(--r-md)] border border-dashed border-line p-3">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Add your own</span>
            <div className="flex gap-2">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as LearningType)}
                aria-label="Learning type"
                className="rounded-[var(--r-md)] border border-line bg-surface px-2 py-1 text-sm"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                rows={2}
                aria-label="Learning text"
                placeholder="What did you learn?"
                className="flex-1 rounded-[var(--r-md)] border border-line bg-surface p-2 text-sm"
              />
              <button
                type="button"
                onClick={() => add.mutate({ bodyMd: newBody, type: newType })}
                disabled={newBody.trim() === '' || add.isPending}
                className="self-start rounded-[var(--r-md)] bg-surface-2 px-3 py-1 text-sm font-medium text-ink disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-3 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => commit.mutate()}
            disabled={allRecorded || keptCount === 0 || commit.isPending}
            className="rounded-[var(--r-md)] bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {commit.isPending ? 'Recording…' : allRecorded ? 'Recorded to journal' : 'Record to journal'}
          </button>
          <span className="text-xs text-ink-faint">
            {allRecorded
              ? 'All kept learnings recorded.'
              : `${keptCount} learning${keptCount === 1 ? '' : 's'} will be written.`}
          </span>
        </div>
      </section>
    </div>
  );
}
