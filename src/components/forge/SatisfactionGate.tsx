'use client';

import { cn } from '@/lib/cn';

/**
 * `SatisfactionGate` (Spec 4 / components/forge — F7/F9/F21) — the dual AI/Human
 * indicator pair + the human nod + Force-advance control.
 *
 * ACCESSIBILITY (F21/F9): satisfaction state is NEVER conveyed by colour alone.
 * Each indicator carries a TEXT label ("AI: satisfied / pending", "Human:
 * approved / pending"), an icon, and `aria-label` + `aria-live` so the change is
 * announced. Force-advance is a LABELLED button (text "Force advance"), not just
 * amber styling.
 */

export interface SatisfactionGateProps {
  aiSatisfied: boolean;
  humanSatisfied: boolean;
  forced: boolean;
  /** True once the section has a draft (the nod is enabled only when drafted). */
  drafted: boolean;
  onNod?: () => void;
  onForceAdvance?: () => void;
  disabled?: boolean;
}

function Indicator({ label, on }: { label: string; on: boolean }) {
  const state = on ? 'satisfied' : 'pending';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        on ? 'bg-sage-tint text-sage-deep' : 'bg-surface-2 text-ink-muted',
      )}
      aria-label={`${label}: ${state}`}
      aria-live="polite"
    >
      <span aria-hidden="true">{on ? '✓' : '○'}</span>
      <span>
        {label}: {state}
      </span>
    </span>
  );
}

export function SatisfactionGate({
  aiSatisfied,
  humanSatisfied,
  forced,
  drafted,
  onNod,
  onForceAdvance,
  disabled = false,
}: SatisfactionGateProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="satisfaction-gate">
      <Indicator label="AI" on={aiSatisfied} />
      <Indicator label="Human" on={humanSatisfied} />
      {forced ? <span className="text-xs text-ink-muted">(forced)</span> : null}
      <button
        type="button"
        onClick={onNod}
        disabled={disabled || !drafted || humanSatisfied}
        className="rounded-[var(--r-md)] bg-sage px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        Looks good
      </button>
      <button
        type="button"
        onClick={onForceAdvance}
        disabled={disabled}
        className="rounded-[var(--r-md)] border border-amber-500 px-3 py-1 text-xs font-medium text-amber-700 disabled:opacity-50"
      >
        Force advance
      </button>
    </div>
  );
}
