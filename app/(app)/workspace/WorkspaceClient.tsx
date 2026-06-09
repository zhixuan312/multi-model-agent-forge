'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { filterRepos } from '@/git/repo-filter';
import { cn } from '@/lib/cn';

export interface RepoCardData {
  id: string;
  name: string;
  kind: string;
  tags: string[];
  defaultBranch: string;
  status: 'cloned' | 'pulling' | 'error';
  headSha: string | null;
}

const STATUS_META: Record<RepoCardData['status'], { label: string; icon: string; cls: string }> = {
  cloned: { label: 'Cloned', icon: '✓', cls: 'text-sage border-sage/40 bg-sage/10' },
  pulling: { label: 'Pulling…', icon: '↻', cls: 'text-amber border-amber/40 bg-amber/10' },
  error: { label: 'Error', icon: '!', cls: 'text-rose border-rose/40 bg-rose/10' },
};

/** Status chip — text label + icon + aria-label, never colour alone (a11y F6). */
function RepoStatusChip({ status }: { status: RepoCardData['status'] }) {
  const m = STATUS_META[status];
  return (
    <span
      role="status"
      aria-label={`Repository status: ${m.label}`}
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', m.cls)}
    >
      <span aria-hidden="true">{m.icon}</span>
      {m.label}
    </span>
  );
}

function RepoCard({
  repo,
  isAdmin,
  onPull,
  onDelete,
  busy,
}: {
  repo: RepoCardData;
  isAdmin: boolean;
  onPull: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div
      data-testid={`repo-${repo.name}`}
      className="rounded-[var(--r-lg)] border border-line bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm font-semibold text-ink">{repo.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-[var(--r)] border border-line-strong bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-soft">
              {repo.kind}
            </span>
            {repo.tags.map((t) => (
              <span key={t} className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <RepoStatusChip status={repo.status} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-ink-faint">
          {repo.defaultBranch}
          {repo.headSha ? ` · ${repo.headSha.slice(0, 8)}` : ''}
        </span>
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPull(repo.id)}
              disabled={busy}
              className="rounded-[var(--r)] border border-line-strong px-2 py-1 text-xs text-ink-soft disabled:opacity-50"
            >
              Pull
            </button>
            <button
              type="button"
              onClick={() => onDelete(repo.id)}
              disabled={busy}
              className="rounded-[var(--r)] border border-rose/40 px-2 py-1 text-xs text-rose disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const inputCls =
  'rounded-[var(--r)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

function CloneRepoDialog({ onClose, onCloned }: { onClose: () => void; onCloned: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState('service');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errId = 'clone-error';

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          url,
          kind,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? 'Could not clone the repo.');
        return;
      }
      onCloned();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Add or clone a repository">
      <div className="w-full max-w-md rounded-[var(--r-lg)] border border-line bg-surface p-5">
        <h2 className="font-serif text-lg font-semibold text-ink">Add / clone repo</h2>
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label htmlFor="clone-name" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Name</label>
            <input id="clone-name" value={name} onChange={(e) => setName(e.target.value)} className={cn(inputCls, 'w-full font-mono')} aria-describedby={error ? errId : undefined} />
          </div>
          <div>
            <label htmlFor="clone-url" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Git URL</label>
            <input id="clone-url" value={url} onChange={(e) => setUrl(e.target.value)} className={cn(inputCls, 'w-full')} placeholder="https://github.com/team/repo.git" />
          </div>
          <div>
            <label htmlFor="clone-kind" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Kind</label>
            <input id="clone-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={cn(inputCls, 'w-full')} placeholder="service / library / infra / docs" />
          </div>
          <div>
            <label htmlFor="clone-tags" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Tags <span className="font-normal text-ink-faint">· comma-separated</span></label>
            <input id="clone-tags" value={tags} onChange={(e) => setTags(e.target.value)} className={cn(inputCls, 'w-full')} placeholder="core, backend" />
          </div>
        </div>
        {error ? <p id={errId} role="alert" className="mt-3 text-sm text-rose">{error}</p> : null}
        <div className="mt-4 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-[var(--r)] border border-line-strong px-3 py-2 text-sm text-ink-soft">Cancel</button>
          <button type="button" onClick={submit} disabled={busy || !name || !url} className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Workspace client island (Spec 2 §Flow E): kind · tag · search filter (AND,
 * case-insensitive) over the RSC-loaded repo list, repo cards with status chips,
 * and the admin add/clone dialog. Non-admins see the list read-only.
 */
export function WorkspaceClient({ initialRepos, isAdmin }: { initialRepos: RepoCardData[]; isAdmin: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState('');
  const [tag, setTag] = useState('');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const kinds = useMemo(() => [...new Set(initialRepos.map((r) => r.kind))].sort(), [initialRepos]);
  const allTags = useMemo(() => [...new Set(initialRepos.flatMap((r) => r.tags))].sort(), [initialRepos]);
  const shown = useMemo(() => filterRepos(initialRepos, { kind, tag, search }), [initialRepos, kind, tag, search]);

  async function onPull(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/repos/${id}`, { method: 'PUT' });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }
  async function onDelete(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/repos/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-kind" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Kind</label>
          <select id="filter-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
            <option value="">All kinds</option>
            {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="filter-tag" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Tag</label>
          <select id="filter-tag" value={tag} onChange={(e) => setTag(e.target.value)} className={inputCls}>
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label htmlFor="filter-search" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Search</label>
          <input id="filter-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name or tag…" className={cn(inputCls, 'w-full')} />
        </div>
        {isAdmin ? (
          <button type="button" onClick={() => setDialogOpen(true)} className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white">
            Add / clone repo
          </button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <div className="grid place-items-center rounded-[var(--r-lg)] border border-dashed border-line bg-surface-2 px-6 py-16 text-center">
          <p className="font-serif text-base italic text-ink-faint">No repositories match.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((r) => (
            <RepoCard key={r.id} repo={r} isAdmin={isAdmin} onPull={onPull} onDelete={onDelete} busy={busyId === r.id} />
          ))}
        </div>
      )}

      {dialogOpen ? <CloneRepoDialog onClose={() => setDialogOpen(false)} onCloned={() => router.refresh()} /> : null}
    </div>
  );
}
