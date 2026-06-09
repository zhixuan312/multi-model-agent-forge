'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface ProviderViewData {
  id: string;
  name: string;
  type: 'claude' | 'codex';
  baseUrl: string | null;
  apiKeySet: boolean;
}

const label = 'mb-1.5 block text-[11.5px] font-semibold text-ink-soft';
const input =
  'w-full rounded-[var(--r)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

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
    <div className="mt-4">
      <table data-testid="providers-table" className="w-full overflow-hidden rounded-[var(--r-lg)] border border-line text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5 font-semibold">Name</th>
            <th className="px-4 py-2.5 font-semibold">Type</th>
            <th className="px-4 py-2.5 font-semibold">Base URL</th>
            <th className="px-4 py-2.5 font-semibold">API key</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {initial.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-5 text-center text-ink-faint">
                No providers yet — add one below.
              </td>
            </tr>
          ) : (
            initial.map((p) => (
              <tr key={p.id} data-testid="provider-row" className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-semibold text-ink">{p.name}</td>
                <td className="px-4 py-3">
                  <span className="rounded-[5px] bg-accent-tint px-2 py-0.5 font-mono text-[11px] text-accent-deep">
                    {p.type}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                  {p.baseUrl ?? <span className="text-ink-faint">— default</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                  {p.apiKeySet ? (
                    <span data-testid="apikey-indicator">•• set</span>
                  ) : (
                    <span data-testid="apikey-indicator" className="text-ink-faint">
                      — not set
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(p);
                      setAdding(false);
                    }}
                    className="text-xs font-medium text-ink-soft hover:text-accent"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {editing ? (
        <ProviderForm
          key={editing.id}
          mode="edit"
          existing={editing}
          onDone={() => setEditing(null)}
        />
      ) : adding ? (
        <ProviderForm mode="add" onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-4 rounded-[var(--r)] border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-accent"
        >
          + Add provider
        </button>
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

      const res = await fetch(
        mode === 'add' ? '/api/providers' : `/api/providers/${existing!.id}`,
        {
          method: mode === 'add' ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
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
    <form
      onSubmit={onSubmit}
      aria-label={mode === 'add' ? 'Add provider' : 'Edit provider'}
      className="mt-4 rounded-[var(--r-lg)] border-[1.5px] border-accent bg-surface p-5 shadow-[0_0_0_3px_var(--accent-tint)]"
    >
      <div className="mb-3.5 text-sm font-semibold text-ink">
        {mode === 'add' ? 'Add provider' : `Edit ${existing?.name}`}
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <label htmlFor="provider-type" className={label}>
            Type
          </label>
          <select
            id="provider-type"
            value={type}
            onChange={(e) => setType(e.target.value as 'claude' | 'codex')}
            aria-describedby={error ? errId : undefined}
            className={input}
          >
            <option value="claude">claude · {TYPE_LABEL.claude}</option>
            <option value="codex">codex · {TYPE_LABEL.codex}</option>
          </select>
        </div>
        <div>
          <label htmlFor="provider-name" className={label}>
            Display name
          </label>
          <input
            id="provider-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={error ? errId : undefined}
            className={input}
          />
        </div>
        <div>
          <label htmlFor="provider-baseurl" className={label}>
            Base URL <span className="font-normal text-ink-faint">· blank = default</span>
          </label>
          <input
            id="provider-baseurl"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className={cn(input, 'font-mono')}
          />
        </div>
        <div>
          <label htmlFor="provider-apikey" className={label}>
            API key{' '}
            <span className="font-normal text-ink-faint">
              · {mode === 'edit' && existing?.apiKeySet ? 'set — blank keeps it' : 'blank = default/none'}
            </span>
          </label>
          <input
            id="provider-apikey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={mode === 'edit' && existing?.apiKeySet ? '•••••••• (unchanged)' : ''}
            className={cn(input, 'font-mono')}
          />
        </div>
      </div>

      {error ? (
        <p id={errId} role="alert" className="mt-3 text-sm text-rose">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center justify-between">
        <div>
          {mode === 'edit' ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="text-sm font-medium text-rose hover:underline disabled:opacity-60"
            >
              Delete
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onDone}
            className="rounded-[var(--r)] border border-line-strong bg-surface px-4 py-2 text-sm text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save provider'}
          </button>
        </div>
      </div>
    </form>
  );
}
