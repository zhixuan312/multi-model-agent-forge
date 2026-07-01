'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { Check, RefreshCw, AlertTriangle, GitBranch, Plus, Trash2, Pencil, Search } from 'lucide-react';
import {
  Card,
  Badge,
  Button,
  Field,
  FieldGrid,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Title,
  Mono,
  Micro,
  EmptyState,
  DataTable,
  type BadgeProps,
} from '@/components/ui';
import { filterRepos } from '@/git/repo-filter';

export interface RepoCardData {
  id: string;
  name: string;
  tags: string[];
  defaultBranch: string;
  status: 'cloned' | 'pulling' | 'error';
  headSha: string | null;
}

const STATUS_META: Record<
  RepoCardData['status'],
  { label: string; variant: NonNullable<BadgeProps['variant']>; icon: React.ReactNode }
> = {
  cloned: { label: 'Cloned', variant: 'sage', icon: <Check /> },
  pulling: { label: 'Pulling…', variant: 'amber', icon: <RefreshCw /> },
  error: { label: 'Error', variant: 'rose', icon: <AlertTriangle /> },
};

/** Status chip — text label + icon + aria-label, never colour alone (a11y F6). */
function RepoStatusChip({ status }: { status: RepoCardData['status'] }) {
  const m = STATUS_META[status];
  return (
    <Badge variant={m.variant} icon={m.icon} role="status" aria-label={`Repository status: ${m.label}`}>
      {m.label}
    </Badge>
  );
}

/**
 * Workspace client island (Spec 2 §Flow E) — the filterable repo TABLE that
 * fills the Primary column; the note rail lives on the page. Mirrors the Team
 * Members table: "New repo" reveals an inline clone form at the top of the table;
 * each admin row carries Pull + a two-step Remove. Filter is tag · search
 * (AND, case-insensitive) over the RSC-loaded list. Non-admins get the table
 * read-only (no actions column, no clone form).
 */
export function WorkspaceClient({ initialRepos, isAdmin }: { initialRepos: RepoCardData[]; isAdmin: boolean }) {
  const router = useRouter();
  const [tag, setTag] = useState('');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openEdit = useCallback((id: string) => { setAdding(false); setEditingId(id); }, []);
  const closeEdit = useCallback(() => { setEditingId(null); setAdding(false); }, []);

  const allTags = useMemo(() => [...new Set(initialRepos.flatMap((r) => r.tags))].sort(), [initialRepos]);
  const shown = useMemo(() => filterRepos(initialRepos, { tag, search }), [initialRepos, tag, search]);

  const onPull = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await fetch(`/api/repos/${id}`, { method: 'PUT' });
        router.refresh();
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );


  const columns = useMemo<ColumnDef<RepoCardData>[]>(() => {
    const base: ColumnDef<RepoCardData>[] = [
      {
        accessorKey: 'name',
        header: 'Repository',
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="min-w-0">
              <Mono className="block truncate !text-sm font-semibold text-ink" title={r.name}>
                {r.name}
              </Mono>
              {r.tags.length ? (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {r.tags.map((t) => (
                    <Badge key={t} variant="accent" size="sm">
                      #{t}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'branch',
        header: 'Branch',
        size: 175,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Micro className="inline-flex items-center gap-1.5 text-ink-soft">
              <GitBranch className="size-3" aria-hidden />
              {r.defaultBranch}
              {r.headSha ? <span className="text-ink-faint"> · {r.headSha.slice(0, 8)}</span> : null}
            </Micro>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 120,
        cell: ({ row }) => <RepoStatusChip status={row.original.status} />,
      },
    ];

    if (!isAdmin) return base;

    base.push({
      id: 'actions',
      header: '',
      size: 180,
      cell: ({ row }) => {
        const r = row.original;
        const busy = busyId === r.id;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="secondary" leftIcon={<RefreshCw />} onClick={() => onPull(r.id)} disabled={busy}>
              Pull
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={() => openEdit(r.id)} disabled={busy}>
              Edit
            </Button>
          </div>
        );
      },
    });
    return base;
  }, [isAdmin, busyId, onPull, openEdit]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <div className="flex items-center justify-between gap-3">
          <Title className="!text-lg">Repositories</Title>
          {isAdmin ? (
            <Button size="sm" leftIcon={<Plus />} onClick={() => { setEditingId(null); setAdding((a) => !a); }}>
              New repo
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Tag">
            {(p) => (
              <Select value={tag || '__all'} onValueChange={(v) => setTag(v === '__all' ? '' : v)}>
                <SelectTrigger {...p} className="min-w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All tags</SelectItem>
                  {allTags.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Search" className="min-w-[200px] flex-1">
            {(p) => (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
                <Input
                  {...p}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="name or tag…"
                  className="pl-9"
                />
              </div>
            )}
          </Field>
        </div>
      </div>

      <DataTable
        fill
        columns={columns}
        data={shown}
        getRowId={(r) => r.id}
        data-testid="repo-table"
        expandedId={editingId}
        renderExpanded={(r) => <RepoEditForm repo={r} onDone={closeEdit} />}
        leadingRow={adding && isAdmin ? <CloneForm onDone={closeEdit} onCloned={() => { closeEdit(); router.refresh(); }} /> : null}
        emptyState={
          <EmptyState
            icon={<GitBranch />}
            title="No repositories match"
            description="Adjust the filters above, or clone a repo to add one."
          />
        }
      />
    </Card>
  );
}

/**
 * Inline edit form for a repo — tags + default branch. Mirrors the Members
 * edit form: Delete on the left, Cancel · Save on the right.
 */
function RepoEditForm({ repo: r, onDone }: { repo: RepoCardData; onDone: () => void }) {
  const router = useRouter();
  const [tagsStr, setTagsStr] = useState(r.tags.join(', '));
  const [defaultBranch, setDefaultBranch] = useState(r.defaultBranch);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/repos/${r.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tags: tagsStr.split(',').map((t) => t.trim()).filter(Boolean),
          defaultBranch: defaultBranch.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? 'Could not update the repo.');
        return;
      }
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    try {
      await fetch(`/api/repos/${r.id}`, { method: 'DELETE' });
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label={`Edit ${r.name}`} className="flex flex-col gap-4 bg-surface-2/50 p-4">
      <FieldGrid cols={2}>
        <Field label="Tags" hint="comma-separated">
          {(p) => <Input {...p} value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} placeholder="core, backend" autoFocus />}
        </Field>
        <Field label="Default branch">
          {(p) => <Input {...p} value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)} placeholder="main" />}
        </Field>
      </FieldGrid>

      {error ? <Micro role="alert" className="block text-rose">{error}</Micro> : null}

      <div className="flex items-center gap-2.5">
        {confirmDelete ? (
          <>
            <Micro className="text-rose">Remove this repo?</Micro>
            <Button type="button" size="sm" variant="ghost" loading={busy} onClick={onDelete} className="text-rose hover:text-rose">
              Confirm
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Keep
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy} className="text-rose hover:text-rose">
            <Trash2 className="mr-1.5 size-3.5" /> Delete
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Inline add / clone form (mirrors the Members add form) — point Forge at a git
 * URL to clone it. Shown as the table's leading row when an admin clicks
 * "New repo". Cancel collapses it; a successful clone refreshes the list.
 */
function CloneForm({ onDone, onCloned }: { onDone: () => void; onCloned: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name || !url) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, url, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? 'Could not clone the repo.');
        return;
      }
      onCloned();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="Clone repo" className="flex flex-col gap-4 bg-surface-2/50 p-4">
      <FieldGrid cols={2}>
        <Field label="Name" hint="lowercased to a snake_case dir — spaces become _">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} className="font-mono" placeholder="payments_api" autoFocus />}
        </Field>
        <Field label="Git URL">
          {(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/team/repo.git" />}
        </Field>
        <Field label="Tags" hint="comma-separated">
          {(p) => <Input {...p} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="core, backend" />}
        </Field>
      </FieldGrid>

      {error ? (
        <Micro role="alert" className="block text-rose">
          {error}
        </Micro>
      ) : null}

      <div className="flex items-center justify-end gap-2.5">
        <Button type="button" variant="secondary" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" leftIcon={<Plus />} loading={busy} disabled={busy || !name || !url}>
          {busy ? 'Cloning…' : 'Clone repo'}
        </Button>
      </div>
    </form>
  );
}
