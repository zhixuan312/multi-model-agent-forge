'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Hand, Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { automationThemeStore } from '@/components/forge/PhaseFromRoute';

/** off = human-driven · running = the AI is driving the loop autonomously. */
export type AutoMode = 'off' | 'running';

/**
 * AutomationBar — the project-level Automated-mode control. When running, the
 * server-side driver executes steps autonomously. The user can stop anytime.
 *
 * Pass `projectId` to use server-side automation (POST /automation/start|stop).
 * The bar reads `autoMode`/`autoNote` from props (server-rendered) and listens
 * for SSE `automation.progress` events for real-time note updates.
 */
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
  const [countdown, setCountdown] = useState<number | null>(null);
  const [liveNote, setLiveNote] = useState(note);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setLiveNote(note); }, [note]);

  // Listen for SSE automation events
  useEffect(() => {
    function onProgress(e: Event) {
      const detail = (e as CustomEvent).detail as { note?: string } | undefined;
      if (detail?.note) setLiveNote(detail.note);
    }
    function onStepDone() {
      router.refresh();
    }
    function onNavigate() {
      // No-op — auto page handles its own display
    }
    function onError(e: Event) {
      const detail = (e as CustomEvent).detail as { error?: string } | undefined;
      if (detail?.error) setLiveNote(`Error: ${detail.error}`);
      router.refresh();
    }
    window.addEventListener('automation:progress', onProgress);
    window.addEventListener('automation:step_done', onStepDone);
    window.addEventListener('automation:navigate', onNavigate);
    window.addEventListener('automation:error', onError);
    return () => {
      window.removeEventListener('automation:progress', onProgress);
      window.removeEventListener('automation:step_done', onStepDone);
      window.removeEventListener('automation:navigate', onNavigate);
      window.removeEventListener('automation:error', onError);
    };
  }, [router]);

  const themeActive = running || countdown !== null;
  useEffect(() => { automationThemeStore.set(themeActive); return () => { automationThemeStore.set(false); }; }, [themeActive]);

  const clearCountdown = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setCountdown(null);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  function handleRun() {
    if (projectId) {
      fetch(`/api/projects/${projectId}/automation/start`, { method: 'POST' })
        .then(() => router.refresh())
        .catch(() => {});
    }
  }

  function handleStop() {
    if (projectId) {
      fetch(`/api/projects/${projectId}/automation/stop`, { method: 'POST' })
        .then(() => router.refresh())
        .catch(() => {});
    }
  }

  function handleRunClick() {
    if (countdown !== null) return;
    setCountdown(3);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearCountdown();
          setTimeout(handleRun, 0);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-3 rounded-[var(--r-lg)] border px-4 py-3 transition-colors',
        running ? 'border-accent/40 bg-accent-tint/40' : 'border-line bg-surface',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          running ? 'bg-accent text-white' : 'bg-surface-2 text-ink-soft',
        )}
      >
        {running ? <Bot className="size-5" /> : <Hand className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          {running ? 'Forge is driving' : countdown !== null ? `Starting in ${countdown}…` : 'You have the wheel'}
          {running ? <span className="inline-flex size-1.5 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden /> : null}
        </p>
        <p className="truncate text-xs text-ink-soft">
          {liveNote ||
            (countdown !== null
              ? 'Forge will take over shortly. Cancel to stay manual.'
              : running
                ? runningHint ?? 'Forge runs the loop and steps through the gates. Stop anytime to take over.'
                : idleHint ?? 'Drive it yourself, or let Forge run Plan → Build → Journal and step in whenever.')}
        </p>
      </div>
      {running ? (
        <Button size="sm" variant="secondary" onClick={handleStop} leftIcon={<Square />}>
          Stop &amp; take over
        </Button>
      ) : countdown !== null ? (
        <Button size="sm" variant="secondary" onClick={clearCountdown}>
          Cancel
        </Button>
      ) : (
        <Button size="sm" onClick={handleRunClick} disabled={disabled} leftIcon={<Bot />}>
          Run automated
        </Button>
      )}
    </div>
  );
}
