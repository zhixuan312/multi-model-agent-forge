'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { Check, RefreshCw, AlertTriangle, GitBranch, Plus, Trash2, Search } from 'lucide-react';
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
  IconButton,
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
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const allTags = useMemo(() => [...new Set(initialRepos.flatMap((r) => r.tags))].sort(), [initialRepos]);
  const shown = useMemo(() => filterRepos(initialRepos, { tag, search }), [initialRepos, tag, search]);

  const closeAdd = useCallback(() => setAdding(false), []);

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

  const onDelete = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await fetch(`/api/repos/${id}`, { method: 'DELETE' });
        setConfirmingId(null);
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
        if (confirmingId === r.id) {
          return (
            <div className="flex items-center justify-end gap-2">
              <Micro className="text-rose">Remove?</Micro>
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() => onDelete(r.id)}
                className="text-rose hover:text-rose"
              >
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)} disabled={busy}>
                Keep
              </Button>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="secondary" leftIcon={<RefreshCw />} onClick={() => onPull(r.id)} disabled={busy}>
              Pull
            </Button>
            <IconButton
              aria-label={`Remove ${r.name}`}
              variant="ghost"
              icon={<Trash2 />}
              onClick={() => setConfirmingId(r.id)}
              disabled={busy}
              className="text-ink-faint hover:text-rose"
            />
          </div>
        );
      },
    });
    return base;
  }, [isAdmin, busyId, confirmingId, onPull, onDelete]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
        <div className="flex items-center justify-between gap-3">
          <Title className="!text-lg">Repositories</Title>
          {isAdmin ? (
            <Button size="sm" leftIcon={<Plus />} onClick={() => setAdding((a) => !a)}>
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
        leadingRow={adding && isAdmin ? <CloneForm onDone={closeAdd} onCloned={() => { closeAdd(); router.refresh(); }} /> : null}
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
        <Field label="Name">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} className="font-mono" placeholder="repo-name" autoFocus />}
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
