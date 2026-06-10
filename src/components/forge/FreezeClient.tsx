'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Snowflake } from 'lucide-react';
import { Markdown } from '@/components/forge/Markdown';
import {
  Button,
  Card,
  CardContent,
  Badge,
  Select,
  Textarea,
  Heading,
  Title,
  Text,
  TextSm,
  Micro,
} from '@/components/ui';
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
      <Card data-testid="freeze-banner" data-frozen={frozen ? 'true' : 'false'}>
        <CardContent className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--frost)] text-[var(--steel-deep)]"
          >
            <Snowflake className="size-5" />
          </span>
          <div className="min-w-0">
            <Title className="!text-lg">
              {frozen ? 'Specification frozen' : 'Freeze the specification'}
            </Title>
            <Text className="mt-1 !text-sm !text-ink-soft">
              {frozen
                ? 'The spec is frozen — this is a point of no return. The project has moved into the Build phase.'
                : 'Freezing is irreversible. Once frozen, the spec is read-only and the project enters Build.'}
            </Text>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Heading className="!text-base">Learnings to record</Heading>
          {propose.isPending ? <Micro className="!text-ink-faint">Proposing…</Micro> : null}
        </div>
        <Text className="!text-sm !text-ink-soft">
          Curate what this project figured out and what was hard. Only kept learnings are written to the team
          journal.
        </Text>

        {error ? <TextSm className="!text-[var(--rose)]">{error}</TextSm> : null}

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
                <Badge variant="neutral" size="sm" className="uppercase">
                  {c.type}
                </Badge>
                {c.status === 'recorded' ? (
                  <Micro className="!text-[var(--sage-deep)]">recorded · {c.recordedNodeId}</Micro>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: c.id, status: 'kept' })}
                      aria-pressed={c.status === 'kept'}
                      className={cn(
                        'rounded-[var(--r-sm)] px-2 py-0.5 text-xs font-medium transition-colors',
                        c.status === 'kept'
                          ? 'bg-sage-tint text-[var(--sage-deep)]'
                          : 'bg-surface-2 text-ink-soft hover:text-ink',
                      )}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus.mutate({ id: c.id, status: 'removed' })}
                      aria-pressed={c.status === 'removed'}
                      className={cn(
                        'rounded-[var(--r-sm)] px-2 py-0.5 text-xs font-medium transition-colors',
                        c.status === 'removed'
                          ? 'bg-rose-tint text-[var(--rose)]'
                          : 'bg-surface-2 text-ink-soft hover:text-ink',
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
          <div className="flex flex-col gap-2 rounded-[var(--r-md)] border border-dashed border-line-strong p-3">
            <Micro className="!font-medium !uppercase !tracking-wide">Add your own</Micro>
            <div className="flex items-start gap-2">
              <Select
                value={newType}
                onChange={(e) => setNewType(e.target.value as LearningType)}
                aria-label="Learning type"
                className="w-auto"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                rows={2}
                aria-label="Learning text"
                placeholder="What did you learn?"
                className="flex-1"
              />
              <Button
                size="sm"
                variant="subtle"
                onClick={() => add.mutate({ bodyMd: newBody, type: newType })}
                loading={add.isPending}
                disabled={newBody.trim() === '' || add.isPending}
              >
                Add
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Button
            onClick={() => commit.mutate()}
            loading={commit.isPending}
            disabled={allRecorded || keptCount === 0 || commit.isPending}
          >
            {commit.isPending ? 'Recording…' : allRecorded ? 'Recorded to journal' : 'Record to journal'}
          </Button>
          <TextSm className="!text-ink-faint">
            {allRecorded
              ? 'All kept learnings recorded.'
              : `${keptCount} learning${keptCount === 1 ? '' : 's'} will be written.`}
          </TextSm>
        </div>
      </section>
    </div>
  );
}
