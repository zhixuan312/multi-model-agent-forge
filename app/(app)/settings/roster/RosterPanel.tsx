'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ModelCombobox, type ModelSuggestion } from './ModelCombobox';

export type Tier = 'main' | 'complex' | 'standard';

export interface RosterRowData {
  tier: Tier;
  providerId: string | null;
  model: string | null;
}
export interface ProviderOption {
  id: string;
  name: string;
}

const TIER_META: Record<Tier, { label: string; note: string }> = {
  main: { label: 'Main / orchestrator', note: 'Forge’s caller model (X-MMA-Main-Model)' },
  complex: { label: 'Complex worker', note: 'MMA worker tier' },
  standard: { label: 'Standard worker', note: 'MMA worker tier' },
};

const label = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-soft';
const input =
  'w-full rounded-[var(--r)] border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

/**
 * Roster panel (Spec 2 §Agent roster / agent-roster.html): three tier rows, each
 * a Provider select + a free-text Model input (Part B wires the profile combobox).
 * Save PUTs the whole roster to the admin API and refreshes.
 */
export function RosterPanel({
  initialRoster,
  providers,
  modelSuggestions = [],
  catalogAvailable = false,
}: {
  initialRoster: RosterRowData[];
  providers: ProviderOption[];
  modelSuggestions?: ModelSuggestion[];
  catalogAvailable?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<RosterRowData[]>(initialRoster);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function update(tier: Tier, patch: Partial<RosterRowData>) {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.tier === tier ? { ...r, ...patch } : r)));
  }

  async function onSave() {
    setError(null);
    setBusy(true);
    try {
      // Send each tier; an empty provider+model clears it (the core validates the
      // both-or-neither rule).
      const tiers = rows.map((r) => ({
        tier: r.tier,
        providerId: r.providerId || null,
        model: r.model ?? '',
      }));
      const res = await fetch('/api/roster', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tiers }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? 'Could not save the roster.');
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const errId = 'roster-error';
  return (
    <div className="mt-4">
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const meta = TIER_META[r.tier];
          return (
            <div
              key={r.tier}
              data-testid={`tier-${r.tier}`}
              className="rounded-[var(--r-lg)] border border-line bg-surface p-4"
            >
              <div className="mb-3 text-sm font-semibold text-ink">
                {meta.label}{' '}
                <span className="font-normal text-xs text-ink-faint">· {meta.note}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`provider-${r.tier}`} className={label}>
                    Provider
                  </label>
                  <select
                    id={`provider-${r.tier}`}
                    value={r.providerId ?? ''}
                    onChange={(e) => update(r.tier, { providerId: e.target.value || null })}
                    className={input}
                  >
                    <option value="">— none</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <ModelCombobox
                  id={`model-${r.tier}`}
                  label="Model"
                  value={r.model ?? ''}
                  onChange={(next) => update(r.tier, { model: next })}
                  suggestions={modelSuggestions}
                  catalogAvailable={catalogAvailable}
                />
              </div>
            </div>
          );
        })}
      </div>

      {error ? (
        <p id={errId} role="alert" className="mt-3 text-sm text-rose">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-3">
        {saved ? <span className="text-sm text-ink-soft">Saved.</span> : null}
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          aria-describedby={error ? errId : undefined}
          className="rounded-[var(--r)] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save roster'}
        </button>
      </div>
    </div>
  );
}
