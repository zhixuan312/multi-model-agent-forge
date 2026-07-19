'use client';

import { Bot, Hand, ListTree, Lock, Square } from 'lucide-react';
import {
  Card,
  Button,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { automationOverlayStore } from '@/components/forge/AutomationGate';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';

/**
 * The stage status strip — the one horizontal bar that says who is driving the project.
 * It is the SAME strip in every state (round badge · title · subtitle · one action), so it
 * lives here once rather than being re-hand-rolled per surface:
 *
 *   idle     → "You have the wheel"   + Run automated   (rendered by each stage client)
 *   locked   → "Stage locked" + why   + no action       (read-only stage)
 *   starting → "Getting ready…" 3-2-1 + Stop & take over
 *   driving  → "Forge is driving"     + Stop & take over  (rendered by AutomationOverlay)
 *   viewing  → "Project activity"     + Close             (read-only activity log)
 *
 * `AutomationOverlay` used to hand-roll the last three as a copy of this markup; it now
 * passes `state` instead, so the strip can never drift between the two surfaces.
 */
export type AutomationBarState = 'idle' | 'starting' | 'driving' | 'viewing';

export function AutomationBar({
  projectId,
  disabled = false,
  idleHint,
  lockedReason,
  state = 'idle',
  countdown = 0,
  pulse = false,
  onRun,
  onStop,
  onClose,
}: {
  projectId?: string;
  disabled?: boolean;
  idleHint?: string;
  /** Set when the stage is read-only; replaces the idle copy with the cause. */
  lockedReason?: string;
  state?: AutomationBarState;
  /** Seconds left on the 3-2-1 hand-over, shown in the badge when `state="starting"`. */
  countdown?: number;
  /** Live-activity dot, shown while genuinely driving. */
  pulse?: boolean;
  /** Overrides the start-automation request — used by the governance demo, which has no project. */
  onRun?: () => void;
  onStop?: () => void;
  onClose?: () => void;
}) {
  const optimistic = useOptimisticAction();

  function handleRun() {
    if (onRun) { onRun(); return; }
    if (!projectId) return;
    // Show overlay IMMEDIATELY (optimistic) — countdown happens on the overlay.
    // Intentionally NO router.refresh() on success — the overlay syncs server state once
    // when the countdown ends, so the top stepper stays still during "Getting ready"
    // instead of jumping as Forge advances spec→plan behind the countdown. On failure the
    // overlay is hidden (rollback) and a toast explains why.
    void optimistic.run({
      apply: () => automationOverlayStore.show(),
      commit: async () => {
        const r = await fetch(`/api/projects/${projectId}/transition`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start_auto' }),
        });
        if (!r.ok) throw new Error(`Request failed (${r.status}).`);
      },
      rollback: () => automationOverlayStore.hide(),
      error: 'Couldn’t start automation — try again.',
      retryable: true,
    });
  }

  const locked = state === 'idle' && Boolean(lockedReason);
  const auto = state === 'starting' || state === 'driving';

  const title = { idle: locked ? 'Stage locked' : 'You have the wheel', starting: 'Getting ready...', driving: 'Forge is driving', viewing: 'Project activity' }[state];
  const subtitle = {
    idle: locked ? lockedReason : (idleHint ?? 'Drive it yourself, or let Forge run Plan → Build → Journal and step in whenever.'),
    starting: `Starting in ${countdown}...`,
    driving: 'Running every step automatically — watch progress below',
    viewing: 'The full record of everything Forge did on this project',
  }[state];

  return (
    <Card className={cn('flex shrink-0 items-center gap-3 px-4 py-3', auto && 'border-accent/40 bg-accent-tint/40')}>
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          auto ? 'bg-accent text-white' : state === 'viewing' ? 'bg-ink-soft text-white' : 'bg-surface-2 text-ink-soft',
        )}
      >
        {state === 'starting' && countdown > 0 ? <span className="text-lg font-bold tabular-nums">{countdown}</span>
          : state === 'driving' ? <Bot className="size-5" />
          : state === 'viewing' ? <ListTree className="size-5" />
          : locked ? <Lock className="size-5" />
          : <Hand className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          {title}
          {state === 'driving' && pulse ? <span className="inline-flex size-1.5 animate-pulse rounded-full bg-accent" /> : null}
        </p>
        <p className="truncate text-xs text-ink-soft">{subtitle}</p>
      </div>
      {auto ? (
        <Button size="sm" variant="secondary" onClick={onStop} leftIcon={<Square />}>
          Stop &amp; take over
        </Button>
      ) : state === 'viewing' ? (
        <Button size="sm" variant="secondary" onClick={onClose}>
          Close
        </Button>
      ) : locked ? null : (
        <Button size="sm" onClick={handleRun} disabled={disabled} leftIcon={<Bot />}>
          Run automated
        </Button>
      )}
    </Card>
  );
}
