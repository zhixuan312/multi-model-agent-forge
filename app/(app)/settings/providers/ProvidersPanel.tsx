'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import {
  Field,
  FieldGrid,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Badge,
  Title,
  TextStrong,
  Mono,
  Micro,
  EmptyState,
  DataTable,
} from '@/components/ui';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';

export interface ProviderViewData {
  id: string;
  name: string;
  type: 'claude' | 'codex';
  baseUrl: string | null;
  apiKeySet: boolean;
}

const TYPE_LABEL: Record<'claude' | 'codex', string> = {
  claude: 'Anthropic-style',
  codex: 'OpenAI-style',
};

const PROVIDERS_NOTE = `**Configuring providers**

\`type\` picks the API dialect — \`claude\` (Anthropic-style) or \`codex\` (OpenAI-style). Leave base URL or key blank to use the provider default; keys are stored encrypted and never shown.`;

type TypeFilter = 'all' | 'claude' | 'codex';

/**
 * Providers panel (Spec 2 §Providers) — the SAME table surface as Members: a
 * searchable/filterable `DataTable` (search by name/URL + a type filter) that
 * scrolls to the page bottom, with inline add (a leading row) and inline edit (an
 * expanding row), both via `ProviderForm`. The api-key field is write-only — the
 * list shows "set / not set", never the value. Rail is the note only.
 */
export function ProvidersPanel({ initial }: { initial: ProviderViewData[] }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const openEdit = useCallback((id: string) => {
    setAdding(false);
    setEditingId(id);
  }, []);
  const openAdd = useCallback(() => {
    setEditingId(null);
    setAdding(true);
  }, []);
  const close = useCallback(() => {
    setEditingId(null);
    setAdding(false);
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initial.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (q && !`${p.name} ${p.baseUrl ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initial, search, typeFilter]);

  const columns = useMemo<ColumnDef<ProviderViewData>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <TextStrong className="block truncate !text-sm !text-ink" title={row.original.name}>
            {row.original.name}
          </TextStrong>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        size: 120,
        cell: ({ row }) => (
          <Badge variant="accent" size="sm">
            <Mono className="!text-[0.6875rem]">{row.original.type}</Mono>
          </Badge>
        ),
      },
      {
        id: 'baseUrl',
        header: 'Base URL',
        cell: ({ row }) =>
          row.original.baseUrl ? (
            <Mono className="block truncate !text-xs text-ink-soft" title={row.original.baseUrl}>
              {row.original.baseUrl}
            </Mono>
          ) : (
            <Micro>— default</Micro>
          ),
      },
      {
        id: 'apikey',
        header: 'API key',
        size: 120,
        cell: ({ row }) =>
          row.original.apiKeySet ? (
            <Mono data-testid="apikey-indicator" className="!text-xs text-[var(--sage-deep)]">
              •• set
            </Mono>
          ) : (
            <Micro data-testid="apikey-indicator">— not set</Micro>
          ),
      },
      {
        id: 'actions',
        header: '',
        size: 84,
        cell: ({ row }) => (
          <div className="text-right">
            <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={() => openEdit(row.original.id)}>
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [openEdit],
  );

  return (
    <div className="grid min-h-0 grid-cols-1 gap-4 lg:h-full lg:grid-cols-3 lg:items-stretch">
      {/* PRIMARY — searchable providers table with inline add/edit */}
      <div className="forge-spotlight flex min-h-0 flex-col overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-pop,0_1px_2px_rgba(33,28,22,.05))] lg:col-span-2">
        <div className="flex shrink-0 flex-col gap-4 border-b border-line p-5">
          <div className="flex items-center justify-between gap-3">
            <Title className="!text-lg">Configured providers</Title>
            <Button size="sm" leftIcon={<Plus />} onClick={openAdd}>
              Add provider
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
              <Input
                aria-label="Search providers"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search providers…"
                className="pl-9"
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
              <SelectTrigger aria-label="Filter by type" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="claude">Anthropic-style</SelectItem>
                <SelectItem value="codex">OpenAI-style</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DataTable
          fill
          columns={columns}
          data={shown}
          data-testid="providers-table"
          getRowId={(p) => p.id}
          expandedId={editingId}
          leadingRow={adding ? <ProviderForm mode="add" onDone={close} /> : null}
          renderExpanded={(p) => <ProviderForm key={p.id} mode="edit" existing={p} onDone={close} />}
          emptyState={
            <EmptyState icon={<Search />} title="No providers match" description="Try a different search or type filter." />
          }
        />
      </div>

      {/* RAIL — note only */}
      <div className="flex min-h-0 flex-col gap-4">
        <SettingsAccessNote body={PROVIDERS_NOTE} />
      </div>
    </div>
  );
}

/**
 * Inline add / edit form (the same 4 fields), rendered beneath a row. The api-key
 * input is write-only: on edit it starts blank and submitting blank leaves the
 * stored key untouched. Both modes carry Save AND Cancel.
 */
export function ProviderForm({
  mode,
  existing,
  onDone,
}: {
  mode: 'add' | 'edit';
  existing?: ProviderViewData;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<'claude' | 'codex'>(existing?.type ?? 'claude');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim() === '') {
      setError('A provider name is required.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), type, baseUrl };
      // Only send apiKey when the field has a value (write-only; blank = leave as-is).
      if (apiKey !== '') body.apiKey = apiKey;

      const res = await fetch(mode === 'add' ? '/api/providers' : `/api/providers/${existing!.id}`, {
        method: mode === 'add' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? 'Could not save the provider.');
        return;
      }
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${existing.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? 'Could not delete the provider.');
        return;
      }
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const errId = 'provider-form-error';
  return (
    <form onSubmit={onSubmit} aria-label={mode === 'add' ? 'Add provider' : 'Edit provider'} className="flex flex-col gap-4 bg-surface-2/50 p-4">
      <FieldGrid cols={2}>
        <Field label="Type">
          {(p) => (
            <Select value={type} onValueChange={(v) => setType(v as 'claude' | 'codex')}>
              <SelectTrigger {...p} aria-describedby={error ? errId : undefined}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude">claude · {TYPE_LABEL.claude}</SelectItem>
                <SelectItem value="codex">codex · {TYPE_LABEL.codex}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Display name">
          {(p) => (
            <Input {...p} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={error ? errId : undefined} autoFocus />
          )}
        </Field>
        <Field label="Base URL" hint="blank = default">
          {(p) => <Input {...p} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="font-mono" />}
        </Field>
        <Field
          label="API key"
          hint={mode === 'edit' && existing?.apiKeySet ? 'set — blank keeps it' : 'blank = default/none'}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={mode === 'edit' && existing?.apiKeySet ? '•••••••• (unchanged)' : ''}
              className="font-mono"
            />
          )}
        </Field>
      </FieldGrid>

      {error ? (
        <Micro id={errId} role="alert" className="block text-rose">
          {error}
        </Micro>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div>
          {mode === 'edit' ? (
            <Button type="button" variant="ghost" leftIcon={<Trash2 />} onClick={onDelete} disabled={busy} className="text-rose hover:text-rose">
              Delete
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2.5">
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? 'Saving…' : 'Save provider'}
          </Button>
        </div>
      </div>
    </form>
  );
}
