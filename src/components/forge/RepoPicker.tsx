'use client';

import { useMemo, useState } from 'react';
import { Field, Input, Select, Checkbox, Badge, Text, Mono } from '@/components/ui';
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

  return (
    <div data-testid="repo-picker" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Search repos" className="min-w-[160px] flex-1">
          {(p) => <Input {...p} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name…" />}
        </Field>
        <Field label="Kind">
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tag">
          {(p) => (
            <Select {...p} value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Text className="!text-sm">
        <b className="text-ink">{selected.length}</b> of {repos.length} selected
      </Text>

      <ul className="list-none divide-y divide-line overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface p-0">
        {shown.map((r) => {
          const available = r.status !== 'error';
          const checked = selectedSet.has(r.id);
          return (
            <li key={r.id} data-testid={`repo-row-${r.name}`} className="flex items-center gap-3 px-4 py-3">
              <Checkbox
                id={`repo-cb-${r.id}`}
                checked={checked}
                disabled={!available}
                aria-label={`Select repository ${r.name}`}
                onChange={() => toggle(r.id, available)}
              />
              <label htmlFor={`repo-cb-${r.id}`} className="flex-1 cursor-pointer">
                <Mono className="!text-sm text-ink">{r.name}</Mono>
              </label>
              {available ? (
                <Badge size="sm">{r.kind}</Badge>
              ) : (
                <Badge data-testid={`repo-unavailable-${r.name}`} variant="rose" size="sm">
                  repo unavailable
                </Badge>
              )}
            </li>
          );
        })}
        {shown.length === 0 ? (
          <li className="px-4 py-6 text-center">
            <Text className="!text-sm italic text-ink-faint">No repositories match.</Text>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
