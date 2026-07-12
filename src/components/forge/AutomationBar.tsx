'use client';

import { useEffect } from 'react';
import { Bot, Hand } from 'lucide-react';
import { Button } from '@/components/ui';
import { automationThemeStore } from '@/components/forge/PhaseFromRoute';
import { automationOverlayStore } from '@/components/forge/AutomationGate';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';

export type AutoMode = 'off' | 'running';

export function AutomationBar({
  projectId,
  mode,
  disabled,
  idleHint,
}: {
  projectId?: string;
  mode: AutoMode;
  note: string;
  disabled: boolean;
  idleHint?: string;
}) {
  const optimistic = useOptimisticAction();
  const running = mode === 'running';

  useEffect(() => { automationThemeStore.set(running); return () => { automationThemeStore.set(false); }; }, [running]);

  function handleRun() {
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

  // If already running (server state), don’t render the bar — overlay handles it
  if (running) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 rounded-[var(--r-lg)] border border-line bg-surface px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-soft">
        <Hand className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">You have the wheel</p>
        <p className="truncate text-xs text-ink-soft">
          {idleHint ?? 'Drive it yourself, or let Forge run Plan → Build → Journal and step in whenever.'}
        </p>
      </div>
      <Button size="sm" onClick={handleRun} disabled={disabled} leftIcon={<Bot />}>
        Run automated
      </Button>
    </div>
  );
}
