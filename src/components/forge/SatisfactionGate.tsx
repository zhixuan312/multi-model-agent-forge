'use client';

import { Check, Circle, ThumbsUp, FastForward } from 'lucide-react';
import { Button } from '@/components/ui';
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
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        on ? 'bg-sage-tint text-[var(--sage-deep)]' : 'bg-surface-2 text-ink-soft ring-1 ring-inset ring-line',
      )}
      aria-label={`${label}: ${state}`}
      aria-live="polite"
    >
      {on ? <Check aria-hidden="true" className="size-3.5" /> : <Circle aria-hidden="true" className="size-3" />}
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
      {forced ? <span className="text-xs text-ink-soft">(forced)</span> : null}
      <Button
        size="sm"
        variant="subtle"
        leftIcon={<ThumbsUp />}
        onClick={onNod}
        disabled={disabled || !drafted || humanSatisfied}
        className="!bg-sage !text-white hover:!brightness-95"
      >
        Looks good
      </Button>
      <Button
        size="sm"
        variant="secondary"
        leftIcon={<FastForward />}
        onClick={onForceAdvance}
        disabled={disabled}
      >
        Force advance
      </Button>
    </div>
  );
}
