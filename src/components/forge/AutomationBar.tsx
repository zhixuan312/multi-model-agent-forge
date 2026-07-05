'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Hand } from 'lucide-react';
import { Button } from '@/components/ui';
import { automationThemeStore } from '@/components/forge/PhaseFromRoute';
import { automationOverlayStore } from '@/components/forge/AutomationGate';

export type AutoMode = 'off' | 'running';

export function AutomationBar({
  projectId,
  mode,
  note,
  disabled,
  idleHint,
  runningHint,
}: {
  projectId?: string;
  mode: AutoMode;
  note: string;
  disabled: boolean;
  idleHint?: string;
  runningHint?: string;
}) {
  const router = useRouter();
  const running = mode === 'running';
  const [liveNote, setLiveNote] = useState(note);

  useEffect(() => { setLiveNote(note); }, [note]);
  useEffect(() => { automationThemeStore.set(running); return () => { automationThemeStore.set(false); }; }, [running]);

  useEffect(() => {
    function onProgress(e: Event) {
      const detail = (e as CustomEvent).detail as { note?: string };
      if (detail?.note) setLiveNote(detail.note);
    }
    function onStepDone() { router.refresh(); }
    function onError(e: Event) {
      const detail = (e as CustomEvent).detail as { error?: string };
      if (detail?.error) setLiveNote(`Error: ${detail.error}`);
      router.refresh();
    }
    window.addEventListener('automation:progress', onProgress);
    window.addEventListener('automation:step_done', onStepDone);
    window.addEventListener('automation:error', onError);
    return () => {
      window.removeEventListener('automation:progress', onProgress);
      window.removeEventListener('automation:step_done', onStepDone);
      window.removeEventListener('automation:error', onError);
    };
  }, [router]);

  function handleRun() {
    if (!projectId) return;
    // Show overlay IMMEDIATELY — countdown happens on the overlay.
    automationOverlayStore.show();
    // Start server automation; the overlay's countdown runs while this resolves.
    // Intentionally NO router.refresh() here — the overlay syncs server state once
    // when the countdown ends, so the top stepper stays still during "Getting
    // ready" instead of jumping as Forge advances spec→plan behind the countdown.
    fetch(`/api/projects/${projectId}/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_auto' }),
    }).catch(() => { automationOverlayStore.hide(); });
  }

  function handleStop() {
    if (!projectId) return;
    automationOverlayStore.hide();
    fetch(`/api/projects/${projectId}/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'take_over' }),
    }).then(() => router.refresh()).catch(() => {});
  }

  // If already running (server state), don't render the bar — overlay handles it
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
