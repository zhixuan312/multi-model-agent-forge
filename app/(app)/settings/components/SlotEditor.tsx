'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui';
import { Governed } from '@/components/governance/governed';
import type { ComponentGovernanceView, GovernanceSlotView, ResolvedGovernanceSlotState } from '@/components/governance/registry';

/**
 * Single-component editor — one governed slot on its own page (developer mode).
 * Owns just this slot's state; edits are patch-shaped PUTs to /api/governance
 * (lock-only or a single changed knob), which the server deep-merges. A failed
 * request reconciles via a GET refresh rather than an unhandled rejection.
 */
export function SlotEditor({ slot: initialSlot }: { slot: GovernanceSlotView }) {
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

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardContent className="flex flex-col gap-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-ink-faint">{slot.canonicalComponent}</p>
              <p className="text-xs text-ink-faint">{slot.canonicalFilePath}</p>
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

          <div className="rounded-md border border-line p-4">
            <Governed slotId={slot.slotId} state={previewState} />
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="py-4 text-sm text-ink-faint">
            <p className="font-medium text-ink">Consumers</p>
            {slot.consumers.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {slot.consumers.map((consumer) => (
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
            {slot.deviations.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {slot.deviations.map((deviation) => (
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
