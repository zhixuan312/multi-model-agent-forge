'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Field, FieldGrid, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Button, Badge, Title, Mono, Micro } from '@/components/ui';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';
import { cn } from '@/lib/cn';

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

/**
 * Providers panel (Spec 2 §Providers / providers.html): inline-everything. The
 * "Add provider" button reveals an inline add row at the top (hidden by default);
 * each row's Edit expands an inline form directly beneath it. Both forms carry
 * Save AND Cancel. The api key field is write-only — the list shows "set / not
 * set", never the value. Rail is the note only.
 */
export function ProvidersPanel({ initial }: { initial: ProviderViewData[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const openEdit = (id: string) => {
    setAdding(false);
    setEditing(id);
  };
  const openAdd = () => {
    setEditing(null);
    setAdding(true);
  };
  const close = () => {
    setEditing(null);
    setAdding(false);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
      {/* PRIMARY — providers table with inline add/edit */}
      <div className="flex flex-col overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-pop,0_1px_2px_rgba(33,28,22,.05))] lg:col-span-2">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line p-5">
          <Title className="!text-lg">Configured providers</Title>
          <Button size="sm" leftIcon={<Plus />} onClick={openAdd}>
            Add provider
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table data-testid="providers-table" className="w-full text-sm">
            <thead className="[&_tr]:border-b [&_tr]:border-line">
              <tr className="text-left">
                <th className="px-4 py-3 t-eyebrow">Name</th>
                <th className="px-4 py-3 t-eyebrow">Type</th>
                <th className="px-4 py-3 t-eyebrow">Base URL</th>
                <th className="px-4 py-3 t-eyebrow">API key</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {adding ? (
                <tr>
                  <td colSpan={5} className="border-b border-line/70 p-0">
                    <ProviderForm mode="add" onDone={close} />
                  </td>
                </tr>
              ) : null}
              {initial.length === 0 ? (
                !adding ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-ink-faint">
                      No providers yet — add one.
                    </td>
                  </tr>
                ) : null
              ) : (
                initial.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      data-testid="provider-row"
                      className={cn(
                        'border-b border-line/70 last:border-0 transition-colors',
                        editing === p.id ? 'bg-accent-tint/40' : 'hover:bg-surface-2',
                      )}
                    >
                      <td className="px-4 py-3.5 font-semibold text-ink">{p.name}</td>
                      <td className="px-4 py-3.5">
                        <Badge variant="accent" size="sm">
                          <Mono className="!text-[0.6875rem]">{p.type}</Mono>
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        {p.baseUrl ? (
                          <Mono className="!text-xs text-ink-soft">{p.baseUrl}</Mono>
                        ) : (
                          <Micro>— default</Micro>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {p.apiKeySet ? (
                          <Mono data-testid="apikey-indicator" className="!text-xs text-[var(--sage-deep)]">
                            •• set
                          </Mono>
                        ) : (
                          <Micro data-testid="apikey-indicator">— not set</Micro>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Button size="sm" variant="ghost" leftIcon={<Pencil />} onClick={() => openEdit(p.id)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                    {editing === p.id ? (
                      <tr>
                        <td colSpan={5} className="border-b border-line/70 p-0">
                          <ProviderForm key={p.id} mode="edit" existing={p} onDone={close} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RAIL — note only */}
      <div className="flex flex-col gap-4">
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
