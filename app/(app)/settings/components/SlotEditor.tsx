'use client';

import { useState } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import { Button, Card, CardContent, Switch, TabBar } from '@/components/ui';
import { Governed } from '@/components/governance/governed';
import { GOVERNANCE_SLOT_NAV, type GovernanceSlotView } from '@/components/governance/registry';
import type { LayerConformance } from '@/governance/conformance';

/**
 * Single-component reference — one governed slot on its own page (developer mode).
 * Governance is a CODE catalog: this page is read-only. It shows the slot's canonical
 * component, an interactive preview with local affordance toggles, and the slot's
 * consumers + deviations. There is no lock/knob persistence.
 */
export function SlotEditor({ slot, variantId, conformance }: { slot: GovernanceSlotView; variantId?: string; conformance?: LayerConformance }) {
  // On a variant sub-page, show the variant's own consumers + canonical; otherwise the slot's.
  const variant = variantId
    ? GOVERNANCE_SLOT_NAV.find((s) => s.slotId === slot.slotId)?.variants.find((v) => v.id === variantId)
    : undefined;
  const canonicalComponent = variant?.canonicalComponent ?? slot.canonicalComponent;
  const canonicalFilePath = variant?.canonicalFilePath ?? slot.canonicalFilePath;

  // Tabbed variants (e.g. Document → Document / Audit / Discussion) show a tab bar that
  // drives the preview AND scopes the affordances / consumers / deviations to the active
  // tab. Non-tabbed variants use the flat affordance list and the variant/slot consumers.
  const tabs = variant?.tabs ?? [];
  const [activeTab, setActiveTab] = useState<string>(() => tabs[0]?.id ?? '');
  // Bumping this remounts the preview, resetting any interactive demo state it holds
  // (audit apply/applied, stage-flow progress, approve toggles…) — the "Reset" button.
  const [resetKey, setResetKey] = useState(0);
  const activeTabObj = tabs.find((t) => t.id === activeTab);
  const affordances = tabs.length > 0 ? (activeTabObj?.affordances ?? []) : (variant?.affordances ?? []);
  const consumers = tabs.length > 0 ? (activeTabObj?.consumers ?? []) : (variant?.consumers ?? slot.consumers);
  const deviations: readonly { id: string; label: string }[] =
    tabs.length > 0 ? (activeTabObj?.deviations ?? []) : (variant?.deviations ?? slot.deviations);

  // Toggling drives the live preview locally. Start from each affordance's `defaultOn`,
  // across every tab so a tab switch never loses a toggle.
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(() =>
    new Set(
      tabs.length > 0
        ? tabs.flatMap((t) => (t.affordances ?? []).filter((a) => a.defaultOn).map((a) => a.id))
        : (variant?.affordances ?? []).filter((a) => a.defaultOn).map((a) => a.id),
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
          <div>
            <p className="text-sm text-ink-faint">{canonicalComponent}</p>
            <p className="text-xs text-ink-faint">{canonicalFilePath}</p>
          </div>

          {tabs.length > 0 ? (
            <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} className="gap-1 self-start" />
          ) : null}

          <div className="rounded-md border border-line p-4">
            <Governed key={resetKey} slotId={slot.slotId} variantId={variantId} enabledAffordances={enabled} activeTab={activeTab} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-ink-faint">The preview is interactive — Reset returns it to the start.</p>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setResetKey((k) => k + 1)}>
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {conformance ? (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Conformance</p>
                <p className="text-xs text-ink-faint">{conformance.convention}</p>
              </div>
              {conformance.violations.length === 0 ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sage-tint px-2.5 py-1 text-xs font-medium text-[var(--sage-deep)]">
                  <Check className="size-3.5" /> {conformance.checked} checked · all conform
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-tint px-2.5 py-1 text-xs font-medium text-rose">
                  <TriangleAlert className="size-3.5" /> {conformance.violations.length} of {conformance.checked} off-convention
                </span>
              )}
            </div>
            {conformance.violations.length > 0 ? (
              <ul className="flex flex-col divide-y divide-line">
                {conformance.violations.map((v) => (
                  <li key={v.file} className="py-2">
                    <p className="font-mono text-xs text-ink">{v.file}</p>
                    <p className="text-xs text-ink-faint">{v.reason}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
