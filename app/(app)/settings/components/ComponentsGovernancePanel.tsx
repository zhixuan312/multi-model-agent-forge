'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui';
import { Governed } from '@/components/governance/governed';
import type { ComponentGovernanceView, GovernanceSlotView, ResolvedGovernanceSlotState } from '@/components/governance/registry';

function groupSlots(view: ComponentGovernanceView) {
  return {
    structural: view.slots.filter((slot) => slot.group === 'structural'),
    leaf: view.slots.filter((slot) => slot.group === 'leaf'),
  };
}

function SlotRow({
  slot,
  onChange,
}: {
  slot: GovernanceSlotView;
  onChange: (next: { locked: boolean; knobs: Record<string, string | boolean> }) => void;
}) {
  const previewState: ResolvedGovernanceSlotState = {
    slotId: slot.slotId,
    locked: slot.locked,
    knobs: slot.knobs,
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-medium text-ink">{slot.label}</h3>
            <p className="text-sm text-ink-faint">{slot.canonicalComponent}</p>
            <p className="text-xs text-ink-faint">{slot.canonicalFilePath}</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <span>Lock {slot.label}</span>
            <Switch
              aria-label={`Lock ${slot.label}`}
              checked={slot.locked}
              onCheckedChange={(checked) => onChange({ locked: checked, knobs: slot.knobs })}
            />
          </label>
        </div>

        <div className="rounded-md border border-line p-3">
          <Governed slotId={slot.slotId} state={previewState} />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {slot.knobSchema.map((knob) => (
            <label key={knob.name} className="flex flex-col gap-2 text-sm text-ink">
              <span>{knob.name}</span>
              {knob.type === 'boolean' ? (
                <Switch
                  aria-label={`${slot.label} ${knob.name}`}
                  checked={Boolean(slot.knobs[knob.name])}
                  onCheckedChange={(checked) => onChange({ locked: slot.locked, knobs: { ...slot.knobs, [knob.name]: checked } })}
                />
              ) : (
                <Select
                  value={String(slot.knobs[knob.name])}
                  onValueChange={(value) => onChange({ locked: slot.locked, knobs: { ...slot.knobs, [knob.name]: value } })}
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

        <div className="text-sm text-ink-faint">
          <p>Consumers</p>
          <ul>{slot.consumers.map((consumer) => <li key={consumer.id}>{consumer.label}</li>)}</ul>
        </div>

        <div className="text-sm text-ink-faint">
          <p>Deviations</p>
          <ul>{slot.deviations.map((deviation) => <li key={deviation.id}>{deviation.label}</li>)}</ul>
        </div>
      </CardContent>
    </Card>
  );
}

export function ComponentsGovernancePanel({ initialView }: { initialView: ComponentGovernanceView }) {
  const [view, setView] = useState<ComponentGovernanceView>(initialView);
  const [, startTransition] = useTransition();

  const grouped = groupSlots(view);

  // Refresh the whole governance view from the route (GET).
  const refresh = async () => {
    const res = await fetch('/api/governance');
    if (res.ok) setView((await res.json()) as ComponentGovernanceView);
  };

  // Save a single slot edit through the route (PUT), then adopt the returned view;
  // fall back to a GET refresh if the save is rejected.
  const persist = (slot: GovernanceSlotView, next: { locked: boolean; knobs: Record<string, string | boolean> }) => {
    startTransition(() => {
      void fetch('/api/governance', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slots: { [slot.slotId]: next } }),
      }).then(async (res) => {
        if (res.ok) {
          setView((await res.json()) as ComponentGovernanceView);
        } else {
          await refresh();
        }
      });
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-ink">Structural</h2>
        {grouped.structural.map((slot) => (
          <SlotRow key={slot.slotId} slot={slot} onChange={(next) => persist(slot, next)} />
        ))}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-ink">Leaf</h2>
        {grouped.leaf.map((slot) => (
          <SlotRow key={slot.slotId} slot={slot} onChange={(next) => persist(slot, next)} />
        ))}
      </section>
    </div>
  );
}
