'use client';

import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { RailCard, RailNote, RailStatus } from '@/components/patterns/feature-rail';
import { RIGHT_PANEL_VARIANTS } from '@/components/governance/variant-meta';

/** Per-kind renders for the Right-panel (rail) layer, keyed by the id in
 *  variant-meta.ts (RIGHT_PANEL_VARIANTS). Real feature-rail components throughout. */
const RENDERS: Record<string, () => ReactNode> = {
  railNote: () => (
    <div className="max-w-sm">
      <RailNote icon={<Info />} title="Rail note">Guidance or status for this page, in the 1/3 rail.</RailNote>
    </div>
  ),
  railCard: () => (
    <div className="max-w-sm">
      <RailCard title="Rail card" badge={3}>
        <p className="text-sm text-ink-soft">A titled rail card with an optional count badge and body content.</p>
      </RailCard>
    </div>
  ),
  railStatus: () => (
    <div className="max-w-sm">
      <RailStatus
        items={[
          { id: '1', label: 'First item', status: 'Done', tone: 'done' },
          { id: '2', label: 'Second item', status: 'Running', tone: 'run', detail: 'in progress' },
          { id: '3', label: 'Third item', status: 'Idle', tone: 'idle' },
        ]}
      />
    </div>
  ),
};

/** Renders one Right-panel kind (a 3rd-layer sub-page), by id. */
export function RightPanelVariant({ id }: { id: string }) {
  const render = RENDERS[id];
  return <>{render ? render() : null}</>;
}

/** Overview (the slot's default page) — every rail kind stacked, in meta order. */
export function RightPanelPreview() {
  return (
    <div className="flex flex-col gap-8">
      {RIGHT_PANEL_VARIANTS.map((v) => (
        <div key={v.id} className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{v.label}</p>
          {RENDERS[v.id]?.()}
        </div>
      ))}
    </div>
  );
}
