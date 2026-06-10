'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, Field, Input, Select, Button, Badge, Mono, Micro } from '@/components/ui';

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

/**
 * Providers panel (Spec 2 §Providers / providers.html): a table of configured
 * providers + an inline add/edit form. The api key field is write-only — the
 * list shows "set / not set", never the value. Mutations hit the admin API and
 * refresh the RSC list.
 */
export function ProvidersPanel({ initial }: { initial: ProviderViewData[] }) {
  const [editing, setEditing] = useState<ProviderViewData | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Card elevation="flat" className="overflow-x-auto">
        <table data-testid="providers-table" className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/60 text-left">
              <th className="px-4 py-3 t-eyebrow">Name</th>
              <th className="px-4 py-3 t-eyebrow">Type</th>
              <th className="px-4 py-3 t-eyebrow">Base URL</th>
              <th className="px-4 py-3 t-eyebrow">API key</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                  No providers yet — add one below.
                </td>
              </tr>
            ) : (
              initial.map((p) => (
                <tr key={p.id} data-testid="provider-row" className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold text-ink">{p.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="accent" size="sm">
                      <Mono className="!text-[0.6875rem]">{p.type}</Mono>
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {p.baseUrl ? (
                      <Mono className="!text-xs text-ink-soft">{p.baseUrl}</Mono>
                    ) : (
                      <Micro>— default</Micro>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.apiKeySet ? (
                      <Mono data-testid="apikey-indicator" className="!text-xs text-[var(--sage-deep)]">
                        •• set
                      </Mono>
                    ) : (
                      <Micro data-testid="apikey-indicator">— not set</Micro>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(p);
                        setAdding(false);
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {editing ? (
        <ProviderForm key={editing.id} mode="edit" existing={editing} onDone={() => setEditing(null)} />
      ) : adding ? (
        <ProviderForm mode="add" onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button variant="secondary" leftIcon={<Plus />} onClick={() => setAdding(true)}>
            Add provider
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Add / edit form (the same 4 fields). The api-key input is write-only: on edit
 * it starts blank and submitting blank leaves the stored key untouched (the form
 * sends apiKey only when the field is non-empty).
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
    <Card className="border-accent ring-[3px] ring-accent-tint">
      <form onSubmit={onSubmit} aria-label={mode === 'add' ? 'Add provider' : 'Edit provider'}>
        <CardContent className="flex flex-col gap-4 py-5">
          <Mono className="!text-sm font-semibold text-ink">
            {mode === 'add' ? 'Add provider' : `Edit ${existing?.name}`}
          </Mono>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              {(p) => (
                <Select
                  {...p}
                  value={type}
                  onChange={(e) => setType(e.target.value as 'claude' | 'codex')}
                  aria-describedby={error ? errId : undefined}
                >
                  <option value="claude">claude · {TYPE_LABEL.claude}</option>
                  <option value="codex">codex · {TYPE_LABEL.codex}</option>
                </Select>
              )}
            </Field>
            <Field label="Display name">
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-describedby={error ? errId : undefined}
                />
              )}
            </Field>
            <Field label="Base URL" hint="blank = default">
              {(p) => (
                <Input {...p} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="font-mono" />
              )}
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
          </div>

          {error ? (
            <Micro id={errId} role="alert" className="block text-rose">
              {error}
            </Micro>
          ) : null}

          <div className="flex items-center justify-between">
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
        </CardContent>
      </form>
    </Card>
  );
}
