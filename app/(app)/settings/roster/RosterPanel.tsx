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
 * Roster panel (Spec 2 §Agent roster). One isolated CARD per tier (main /
 * complex / standard), each with its OWN Save button — saving a card PUTs only
 * that tier (`{ tiers: [<tier>] }`), exactly like Connections saves each section
 * independently. Each card is a Provider select + a Model select constrained to
 * the models the chosen provider serves.
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
  const [busy, setBusy] = useState<Tier | null>(null);
  const [saved, setSaved] = useState<Tier | null>(null);
  const [error, setError] = useState<{ tier: Tier; message: string } | null>(null);

  function update(tier: Tier, patch: Partial<RosterRowData>) {
    setSaved((s) => (s === tier ? null : s));
    setRows((rs) => rs.map((r) => (r.tier === tier ? { ...r, ...patch } : r)));
  }

  // Switching provider re-scopes the model: keep it only if the new provider
  // still serves it, otherwise clear it.
  function onProviderChange(tier: Tier, providerId: string | null) {
    const models = providerId ? modelsByProvider[providerId] ?? [] : [];
    const current = rows.find((r) => r.tier === tier)?.model ?? null;
    update(tier, { providerId, model: current && models.includes(current) ? current : null });
  }

  /** Save ONE tier — PUT only that tier so the others are untouched. */
  async function save(tier: Tier) {
    const row = rows.find((r) => r.tier === tier);
    if (!row) return;
    setError(null);
    setSaved(null);
    setBusy(tier);
    try {
      const res = await fetch('/api/roster', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tiers: [{ tier: row.tier, providerId: row.providerId || null, model: row.model ?? '' }] }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError({ tier, message: b?.error ?? 'Could not save this tier.' });
        return;
      }
      setSaved(tier);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
      {/* PRIMARY — one isolated, independently-saved card per tier */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        {rows.map((r) => {
          const meta = TIER_META[r.tier];
          const models = r.providerId ? modelsByProvider[r.providerId] ?? [] : [];
          const errId = `roster-error-${r.tier}`;
          return (
            <Card key={r.tier} data-testid={`tier-${r.tier}`}>
              <form
                aria-label={`${meta.label} tier`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(r.tier);
                }}
              >
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

                  <div className="flex items-center justify-end gap-2.5">
                    {error?.tier === r.tier ? (
                      <Micro id={errId} role="alert" className="mr-auto text-rose">
                        {error.message}
                      </Micro>
                    ) : null}
                    {saved === r.tier ? <Micro>Saved.</Micro> : null}
                    <Button type="submit" loading={busy === r.tier} aria-describedby={error?.tier === r.tier ? errId : undefined}>
                      {busy === r.tier ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </CardContent>
              </form>
            </Card>
          );
        })}
      </div>

      {/* RAIL — one combined note */}
      <div className="flex flex-col gap-4">
        <SettingsAccessNote body={ROSTER_NOTE} />
      </div>
    </div>
  );
}
