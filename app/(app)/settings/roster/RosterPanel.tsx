'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Field, FieldGrid, Select, Button, Mono, Micro } from '@/components/ui';
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const meta = TIER_META[r.tier];
          return (
            <Card key={r.tier} data-testid={`tier-${r.tier}`} elevation="flat">
              <CardContent className="flex flex-col gap-3 py-4">
                <div>
                  <Mono className="!text-sm font-semibold text-ink">{meta.label}</Mono>{' '}
                  <Micro>· {meta.note}</Micro>
                </div>
                <FieldGrid cols={2}>
                  <Field label="Provider" id={`provider-${r.tier}`}>
                    {(p) => (
                      <Select
                        {...p}
                        value={r.providerId ?? ''}
                        onChange={(e) => update(r.tier, { providerId: e.target.value || null })}
                      >
                        <option value="">— none</option>
                        {providers.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <ModelCombobox
                    id={`model-${r.tier}`}
                    label="Model"
                    value={r.model ?? ''}
                    onChange={(next) => update(r.tier, { model: next })}
                    suggestions={modelSuggestions}
                    catalogAvailable={catalogAvailable}
                  />
                </FieldGrid>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {error ? (
        <Micro id={errId} role="alert" className="block text-rose">
          {error}
        </Micro>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {saved ? <Micro>Saved.</Micro> : null}
        <Button type="button" onClick={onSave} loading={busy} aria-describedby={error ? errId : undefined}>
          {busy ? 'Saving…' : 'Save roster'}
        </Button>
      </div>
    </div>
  );
}
