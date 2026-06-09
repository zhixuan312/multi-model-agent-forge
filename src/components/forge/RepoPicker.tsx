'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { filterRepos } from '@/git/repo-filter';

/**
 * RepoPicker (Spec 3 flow 1) — the new-project repo-subset picker. Hydrates the
 * bounded workspace repo set once and client-filters in-memory (search · kind ·
 * tag, AND-combined; semantics in `filterRepos`). A repo with status='error' (or
 * a missing row) renders a non-selectable "repo unavailable" chip. Selection is
 * a controlled set of repo ids surfaced to the parent form via `onChange`.
 */

export interface RepoPickerRepo {
  id: string;
  name: string;
  kind: string;
  tags: string[];
  status: 'cloned' | 'pulling' | 'error';
}

export interface RepoPickerProps {
  repos: RepoPickerRepo[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function RepoPicker({ repos, selected, onChange }: RepoPickerProps) {
  const [kind, setKind] = useState('');
  const [tag, setTag] = useState('');
  const [search, setSearch] = useState('');

  const kinds = useMemo(() => [...new Set(repos.map((r) => r.kind))].sort(), [repos]);
  const allTags = useMemo(() => [...new Set(repos.flatMap((r) => r.tags))].sort(), [repos]);
  const shown = useMemo(() => filterRepos(repos, { kind, tag, search }), [repos, kind, tag, search]);

  const selectedSet = new Set(selected);

  function toggle(id: string, available: boolean) {
    if (!available) return; // unavailable repos are non-selectable
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  const inputCls =
    'rounded-[var(--r)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

  return (
    <div data-testid="repo-picker">
      <div className="mb-3 flex flex-wrap items-end gap-2.5">
        <div className="min-w-[160px] flex-1">
          <label htmlFor="repo-search" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Search repos
          </label>
          <input
            id="repo-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name…"
            className={cn(inputCls, 'w-full')}
          />
        </div>
        <div>
          <label htmlFor="repo-kind" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Kind
          </label>
          <select id="repo-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="repo-tag" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Tag
          </label>
          <select id="repo-tag" value={tag} onChange={(e) => setTag(e.target.value)} className={inputCls}>
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="mb-2 text-xs text-ink-soft">
        <b>{selected.length}</b> of {repos.length} selected
      </p>

      <ul className="list-none divide-y divide-line rounded-[var(--r-lg)] border border-line bg-surface p-0">
        {shown.map((r) => {
          const available = r.status !== 'error';
          const checked = selectedSet.has(r.id);
          return (
            <li key={r.id} data-testid={`repo-row-${r.name}`} className="flex items-center gap-3 px-4 py-3">
              <input
                id={`repo-cb-${r.id}`}
                type="checkbox"
                checked={checked}
                disabled={!available}
                aria-label={`Select repository ${r.name}`}
                onChange={() => toggle(r.id, available)}
                className="h-4 w-4 accent-[var(--accent)] disabled:opacity-40"
              />
              <label htmlFor={`repo-cb-${r.id}`} className="flex-1 font-mono text-sm text-ink">
                {r.name}
              </label>
              {available ? (
                <span className="rounded-[var(--r)] bg-surface-2 px-2 py-0.5 text-[11px] text-ink-soft">{r.kind}</span>
              ) : (
                <span
                  data-testid={`repo-unavailable-${r.name}`}
                  className="rounded-full border border-rose/40 bg-rose/10 px-2 py-0.5 text-[11px] text-rose"
                >
                  repo unavailable
                </span>
              )}
            </li>
          );
        })}
        {shown.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm italic text-ink-faint">No repositories match.</li>
        ) : null}
      </ul>
    </div>
  );
}
