'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, RefreshCw, AlertTriangle, GitBranch, Plus, Trash2 } from 'lucide-react';
import {
  Card,
  CardContent,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Mono,
  Micro,
  EmptyState,
  Toolbar,
  Grid,
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogFooter,
  type BadgeProps,
} from '@/components/ui';
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

/** Status chip — text label + icon + role/aria-label, never colour alone (a11y F6). */
function RepoStatusChip({ status }: { status: RepoCardData['status'] }) {
  const m = STATUS_META[status];
  return (
    <Badge variant={m.variant} icon={m.icon} role="status" aria-label={`Repository status: ${m.label}`}>
      {m.label}
    </Badge>
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
    <Card data-testid={`repo-${repo.name}`}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Mono className="!text-sm font-semibold text-ink">{repo.name}</Mono>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge size="sm">{repo.kind}</Badge>
              {repo.tags.map((t) => (
                <Badge key={t} variant="accent" size="sm">
                  #{t}
                </Badge>
              ))}
            </div>
          </div>
          <RepoStatusChip status={repo.status} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Micro className="inline-flex items-center gap-1.5">
            <GitBranch className="size-3" aria-hidden />
            {repo.defaultBranch}
            {repo.headSha ? ` · ${repo.headSha.slice(0, 8)}` : ''}
          </Micro>
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" leftIcon={<RefreshCw />} onClick={() => onPull(repo.id)} disabled={busy}>
                Pull
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<Trash2 />} onClick={() => onDelete(repo.id)} disabled={busy} className="text-rose hover:text-rose">
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function CloneRepoDialog({ open, onClose, onCloned }: { open: boolean; onClose: () => void; onCloned: () => void }) {
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
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogPanel>
        <DialogTitle>Add / clone repo</DialogTitle>
        <div className="mt-4 flex flex-col gap-4 px-6">
          <Field label="Name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} className="font-mono" />}
          </Field>
          <Field label="Git URL">
            {(p) => (
              <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/team/repo.git" />
            )}
          </Field>
          <Field label="Kind">
            {(p) => (
              <Input {...p} value={kind} onChange={(e) => setKind(e.target.value)} placeholder="service / library / infra / docs" />
            )}
          </Field>
          <Field label="Tags" hint="comma-separated">
            {(p) => <Input {...p} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="core, backend" />}
          </Field>
        </div>
        {error ? (
          <p role="alert" className="mt-3 px-6 t-sm text-rose">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={busy || !name || !url}>
            {busy ? 'Cloning…' : 'Clone'}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
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
    <div className="flex flex-col gap-5">
      <Toolbar
        align="end"
        actions={
          isAdmin ? (
            <Button leftIcon={<Plus />} onClick={() => setDialogOpen(true)}>
              Add / clone repo
            </Button>
          ) : null
        }
      >
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
        <Field label="Search" className="min-w-[180px] flex-1">
          {(p) => <Input {...p} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name or tag…" />}
        </Field>
      </Toolbar>

      {shown.length === 0 ? (
        <EmptyState icon={<GitBranch />} title="No repositories match" description="Adjust the filters above to widen the search." />
      ) : (
        <Grid min="340px">
          {shown.map((r) => (
            <RepoCard key={r.id} repo={r} isAdmin={isAdmin} onPull={onPull} onDelete={onDelete} busy={busyId === r.id} />
          ))}
        </Grid>
      )}

      {isAdmin ? (
        <CloneRepoDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCloned={() => router.refresh()} />
      ) : null}
    </div>
  );
}
