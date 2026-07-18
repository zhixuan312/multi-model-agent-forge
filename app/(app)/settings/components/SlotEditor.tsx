'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui';
import { Governed } from '@/components/governance/governed';
import { GOVERNANCE_SLOT_NAV, type ComponentGovernanceView, type GovernanceSlotView, type ResolvedGovernanceSlotState } from '@/components/governance/registry';

/**
 * Single-component editor — one governed slot on its own page (developer mode).
 * Owns just this slot's state; edits are patch-shaped PUTs to /api/governance
 * (lock-only or a single changed knob), which the server deep-merges. A failed
 * request reconciles via a GET refresh rather than an unhandled rejection.
 */
export function SlotEditor({ slot: initialSlot, variantId }: { slot: GovernanceSlotView; variantId?: string }) {
  const [slot, setSlot] = useState<GovernanceSlotView>(initialSlot);
  const [, startTransition] = useTransition();

  const adopt = (view: ComponentGovernanceView) => {
    const next = view.slots.find((s) => s.slotId === slot.slotId);
    if (next) setSlot(next);
  };

  const refresh = async () => {
    const res = await fetch('/api/governance');
    if (res.ok) adopt((await res.json()) as ComponentGovernanceView);
  };

  const persist = (next: { locked: boolean; knobs?: Record<string, string | boolean> }) => {
    startTransition(() => {
      void fetch('/api/governance', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slots: { [slot.slotId]: next } }),
      })
        .then(async (res) => {
          if (res.ok) adopt((await res.json()) as ComponentGovernanceView);
          else await refresh();
        })
        .catch(() => {
          void refresh();
        });
    });
  };

  const previewState: ResolvedGovernanceSlotState = {
    slotId: slot.slotId,
    locked: slot.locked,
    knobs: slot.knobs,
  };

  // On a variant sub-page, show the variant's own consumers + canonical; otherwise the slot's.
  const variant = variantId
    ? GOVERNANCE_SLOT_NAV.find((s) => s.slotId === slot.slotId)?.variants.find((v) => v.id === variantId)
    : undefined;
  const canonicalComponent = variant?.canonicalComponent ?? slot.canonicalComponent;
  const canonicalFilePath = variant?.canonicalFilePath ?? slot.canonicalFilePath;

  // Tabbed variants (e.g. Document → Document / Audit / Discussion) show a tab bar that
  // drives the preview AND scopes the affordances / consumers / deviations to the active
  // tab (each tab's section is used in different places). Non-tabbed variants use the flat
  // affordance list and the variant/slot consumers.
  const tabs = variant?.tabs ?? [];
  const [activeTab, setActiveTab] = useState<string>(() => tabs[0]?.id ?? '');
  const activeTabObj = tabs.find((t) => t.id === activeTab);
  const affordances = tabs.length > 0 ? (activeTabObj?.affordances ?? []) : (variant?.affordances ?? []);
  const consumers = tabs.length > 0 ? (activeTabObj?.consumers ?? []) : (variant?.consumers ?? slot.consumers);
  const deviations: readonly { id: string; label: string }[] = tabs.length > 0 ? (activeTabObj?.deviations ?? []) : slot.deviations;

  // Toggling drives the live preview locally (governance persistence TBD). Default all on,
  // across every tab so a tab switch never loses a toggle.
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(() =>
    new Set(
      tabs.length > 0
        ? tabs.flatMap((t) => (t.affordances ?? []).map((a) => a.id))
        : (variant?.affordances ?? []).map((a) => a.id),
    ),
  );
  const toggleAffordance = (id: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardContent className="flex flex-col gap-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-ink-faint">{canonicalComponent}</p>
              <p className="text-xs text-ink-faint">{canonicalFilePath}</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <span>Lock {slot.label}</span>
              <Switch
                aria-label={`Lock ${slot.label}`}
                checked={slot.locked}
                onCheckedChange={(checked) => persist({ locked: checked })}
              />
            </label>
          </div>

          {tabs.length > 0 ? (
            <div role="tablist" className="flex items-center gap-1 self-start rounded-[var(--r)] border border-line bg-surface-2 p-0.5">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={
                    'rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ' +
                    (activeTab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink')
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="rounded-md border border-line p-4">
            <Governed slotId={slot.slotId} state={previewState} variantId={variantId} enabledAffordances={enabled} activeTab={activeTab} />
          </div>

          {slot.knobSchema.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {slot.knobSchema.map((knob) => (
                <label key={knob.name} className="flex flex-col gap-2 text-sm text-ink">
                  <span>{knob.name}</span>
                  {knob.type === 'boolean' ? (
                    <Switch
                      aria-label={`${slot.label} ${knob.name}`}
                      checked={Boolean(slot.knobs[knob.name])}
                      onCheckedChange={(checked) => persist({ locked: slot.locked, knobs: { [knob.name]: checked } })}
                    />
                  ) : (
                    <Select
                      value={String(slot.knobs[knob.name])}
                      onValueChange={(value) => persist({ locked: slot.locked, knobs: { [knob.name]: value } })}
                    >
                      <SelectTrigger aria-label={`${slot.label} ${knob.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {knob.allowedValues.map((value) => (
                          <SelectItem key={String(value)} value={String(value)}>
                            {String(value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-faint">This component has no configurable knobs.</p>
          )}
        </CardContent>
      </Card>

      {affordances.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <div>
              <p className="text-sm font-medium text-ink">Affordances</p>
              <p className="text-xs text-ink-faint">
                The fixed menu a consumer may switch on. Each maps to one shared component — a child composes
                from these and cannot invent its own.
              </p>
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {affordances.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{a.label}</p>
                    <p className="text-xs text-ink-faint">
                      {a.canonicalComponent} · {a.canonicalFilePath}
                    </p>
                  </div>
                  <Switch
                    aria-label={a.label}
                    checked={enabled.has(a.id)}
                    onCheckedChange={() => toggleAffordance(a.id)}
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="py-4 text-sm text-ink-faint">
            <p className="font-medium text-ink">Consumers</p>
            {consumers.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {consumers.map((consumer) => (
                  <li key={consumer.id}>{consumer.label}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">No adopters yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-sm text-ink-faint">
            <p className="font-medium text-ink">Deviations</p>
            {deviations.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {deviations.map((deviation) => (
                  <li key={deviation.id}>{deviation.label}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">No known deviations.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
