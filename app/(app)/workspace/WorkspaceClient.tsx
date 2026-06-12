'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { Check, RefreshCw, AlertTriangle, GitBranch, Plus, Trash2 } from 'lucide-react';
import {
  Card,
  CardContent,
  Badge,
  Button,
  Field,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Mono,
  Micro,
  Eyebrow,
  EmptyState,
  DataTable,
  IconButton,
  type BadgeProps,
} from '@/components/ui';
import { Markdown } from '@/components/forge/Markdown';
import { filterRepos } from '@/git/repo-filter';

export interface RepoCardData {
  id: string;
  name: string;
  kind: string;
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
 * Workspace client island (Spec 2 §Flow E) — the filterable repo TABLE in the
 * 2/3 primary, and the workspace note + admin clone form in the 1/3 rail. Filter
 * is kind · tag · search (AND, case-insensitive) over the RSC-loaded list.
 * Non-admins get the table read-only (no actions column, no clone form).
 */
export function WorkspaceClient({ initialRepos, isAdmin }: { initialRepos: RepoCardData[]; isAdmin: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState('');
  const [tag, setTag] = useState('');
  const [search, setSearch] = useState('');
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

  const columns: ColumnDef<RepoCardData>[] = [
    {
      accessorKey: 'name',
      header: 'Repository',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="min-w-0">
            <Mono className="!text-sm font-semibold text-ink">{r.name}</Mono>
            {r.tags.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
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
      accessorKey: 'kind',
      header: 'Kind',
      size: 120,
      cell: ({ getValue }) => <Badge size="sm">{getValue() as string}</Badge>,
    },
    {
      id: 'branch',
      header: 'Branch',
      size: 190,
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
      size: 130,
      cell: ({ row }) => <RepoStatusChip status={row.original.status} />,
    },
  ];

  if (isAdmin) {
    columns.push({
      id: 'actions',
      header: '',
      size: 150,
      cell: ({ row }) => {
        const r = row.original;
        const busy = busyId === r.id;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="secondary" leftIcon={<RefreshCw />} onClick={() => onPull(r.id)} disabled={busy}>
              Pull
            </Button>
            <IconButton
              aria-label={`Remove ${r.name}`}
              variant="ghost"
              icon={<Trash2 />}
              onClick={() => onDelete(r.id)}
              disabled={busy}
              className="text-ink-faint hover:text-rose"
            />
          </div>
        );
      },
    });
  }

  return (
    <div className="grid min-h-0 grid-cols-1 gap-4 lg:h-full lg:grid-cols-3 lg:items-stretch">
      {/* PRIMARY (2/3) — filters + scrollable repo table */}
      <Card className="flex min-h-0 flex-col lg:col-span-2">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex shrink-0 flex-wrap items-end gap-3">
            <Field label="Kind">
              {(p) => (
                <Select value={kind || '__all'} onValueChange={(v) => setKind(v === '__all' ? '' : v)}>
                  <SelectTrigger {...p} className="min-w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All kinds</SelectItem>
                    {kinds.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
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
            <Field label="Search" className="min-w-[180px] flex-1">
              {(p) => <Input {...p} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name or tag…" />}
            </Field>
          </div>

          <DataTable
            fill
            columns={columns}
            data={shown}
            getRowId={(r) => r.id}
            data-testid="repo-table"
            emptyState={
              <EmptyState
                icon={<GitBranch />}
                title="No repositories match"
                description="Adjust the filters above to widen the search."
              />
            }
          />
        </CardContent>
      </Card>

      {/* RAIL (1/3) — note + admin clone form */}
      <div className="flex min-h-0 flex-col gap-4">
        <WorkspaceNote />
        {isAdmin ? <CloneForm onCloned={() => router.refresh()} /> : null}
      </div>
    </div>
  );
}

const NOTE_MD = `**Shared repositories**

The team's git repos cloned on disk — they become the roots projects build against. Admins **clone**, **pull**, and **remove** them; everyone else sees the pool read-only.

A repo is \`pulling\` while git runs, \`cloned\` when ready, or \`error\` if the last operation failed.`;

const NOTE_PROSE =
  'min-w-0 ' +
  'prose-p:my-1.5 prose-p:text-xs prose-p:leading-relaxed prose-p:text-ink-soft ' +
  'prose-strong:text-ink prose-strong:font-semibold ' +
  'prose-code:rounded prose-code:bg-accent-tint/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.7rem] ' +
  'prose-code:font-medium prose-code:text-accent-deep prose-code:before:content-none prose-code:after:content-none';

function WorkspaceNote() {
  return (
    <div className="flex items-start gap-3 rounded-[var(--r-lg)] border border-accent-tint bg-accent-tint/40 px-4 py-4">
      <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-tint text-accent">
        <GitBranch className="size-5" />
      </span>
      <Markdown className={NOTE_PROSE}>{NOTE_MD}</Markdown>
    </div>
  );
}

/** The admin add/clone form — point Forge at a git URL to clone it (rail card). */
function CloneForm({ onCloned }: { onCloned: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState('service');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, url, kind, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? 'Could not clone the repo.');
        return;
      }
      setName('');
      setUrl('');
      setKind('service');
      setTags('');
      onCloned();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <Eyebrow className="flex items-center gap-1.5 text-ink-faint">
          <Plus className="size-3.5" /> Add / clone repo
        </Eyebrow>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && name && url) submit();
          }}
          className="mt-3 flex flex-col gap-3"
        >
          <Field label="Name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} className="font-mono" placeholder="repo-name" />}
          </Field>
          <Field label="Git URL">
            {(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/team/repo.git" />}
          </Field>
          <Field label="Kind">
            {(p) => <Input {...p} value={kind} onChange={(e) => setKind(e.target.value)} placeholder="service / library / infra / docs" />}
          </Field>
          <Field label="Tags" hint="comma-separated">
            {(p) => <Input {...p} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="core, backend" />}
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-rose">
              {error}
            </p>
          ) : null}
          <Button type="submit" leftIcon={<Plus />} loading={busy} disabled={busy || !name || !url} className="self-start">
            {busy ? 'Cloning…' : 'Clone repo'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
