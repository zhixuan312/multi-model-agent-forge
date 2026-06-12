'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Field, FieldGrid, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Button, Mono, Micro } from '@/components/ui';
import { SettingsAccessNote } from '@/components/forge/SettingsAccessNote';

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

/** Standardized `Name / Responsibility` labels — no internal-implementation aside. */
const TIER_META: Record<Tier, { label: string }> = {
  main: { label: 'Main / Orchestrator' },
  complex: { label: 'Complex / Worker' },
  standard: { label: 'Standard / Worker' },
};

const ROSTER_NOTE = `**Provider → model**

- **Main** — orchestrates every run
- **Complex** — reasoning-heavy worker
- **Standard** — routine worker

Pick a provider first — the model list is limited to what that provider serves.`;

/**
 * Roster panel (Spec 2 §Agent roster / agent-roster.html): one CARD per tier
 * (main / complex / standard), each a Provider select + a Model select that is
 * constrained to the models the chosen provider actually serves. Save PUTs the
 * whole roster to the admin API and refreshes.
 */
export function RosterPanel({
  initialRoster,
  providers,
  modelsByProvider,
}: {
  initialRoster: RosterRowData[];
  providers: ProviderOption[];
  /** providerId → the models that provider serves (the only allowed choices). */
  modelsByProvider: Record<string, string[]>;
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

  // Switching provider re-scopes the model: keep it only if the new provider
  // still serves it, otherwise clear it.
  function onProviderChange(tier: Tier, providerId: string | null) {
    const models = providerId ? modelsByProvider[providerId] ?? [] : [];
    const current = rows.find((r) => r.tier === tier)?.model ?? null;
    update(tier, { providerId, model: current && models.includes(current) ? current : null });
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
      {/* PRIMARY — one isolated card per tier (heterogeneous settings), then save */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        {rows.map((r) => {
          const meta = TIER_META[r.tier];
          const models = r.providerId ? modelsByProvider[r.providerId] ?? [] : [];
          return (
            <Card key={r.tier} data-testid={`tier-${r.tier}`}>
              <CardContent className="flex flex-col gap-4 py-5">
                <Mono className="!text-sm font-semibold text-ink">{meta.label}</Mono>
                <FieldGrid cols={2}>
                  <Field label="Provider" id={`provider-${r.tier}`}>
                    {(p) => (
                      <Select
                        value={r.providerId ?? '__none'}
                        onValueChange={(v) => onProviderChange(r.tier, v === '__none' ? null : v)}
                      >
                        <SelectTrigger {...p}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">— none</SelectItem>
                          {providers.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                  <Field label="Model" id={`model-${r.tier}`}>
                    {(p) => (
                      <Select
                        value={r.model ?? undefined}
                        onValueChange={(v) => update(r.tier, { model: v })}
                        disabled={!r.providerId}
                      >
                        <SelectTrigger {...p}>
                          <SelectValue placeholder={r.providerId ? 'Select a model' : 'Choose a provider first'} />
                        </SelectTrigger>
                        <SelectContent>
                          {models.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                </FieldGrid>
              </CardContent>
            </Card>
          );
        })}

        <div className="flex items-center justify-end gap-3">
          {error ? (
            <Micro id={errId} role="alert" className="mr-auto text-rose">
              {error}
            </Micro>
          ) : null}
          {saved ? <Micro>Saved.</Micro> : null}
          <Button type="button" onClick={onSave} loading={busy} aria-describedby={error ? errId : undefined}>
            {busy ? 'Saving…' : 'Save roster'}
          </Button>
        </div>
      </div>

      {/* RAIL — one combined note */}
      <div className="flex flex-col gap-4">
        <SettingsAccessNote body={ROSTER_NOTE} />
      </div>
    </div>
  );
}
