'use client';

import { Bot, Hand, Square } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';

/** off = human-driven · running = the AI is driving the loop autonomously. */
export type AutoMode = 'off' | 'running';

/**
 * AutomationBar — the project-level Automated-mode control shared across the
 * BUILD-onward stages (Plan, Execute, Review, Journal). When running, Forge drives
 * the loop; the human can Stop and take over mid-flight because the on-disk plan is
 * the shared source of truth, so the baton passes freely either way.
 */
export function AutomationBar({
  mode,
  note,
  disabled,
  idleHint,
  runningHint,
  onRun,
  onStop,
}: {
  mode: AutoMode;
  note: string;
  disabled: boolean;
  idleHint?: string;
  runningHint?: string;
  onRun: () => void;
  onStop: () => void;
}) {
  const running = mode === 'running';
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
          {running ? 'Forge is driving' : 'You have the wheel'}
          {running ? <span className="inline-flex size-1.5 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden /> : null}
        </p>
        <p className="truncate text-xs text-ink-soft">
          {note ||
            (running
              ? runningHint ?? 'Forge runs the loop and steps through the gates. Stop anytime to take over.'
              : idleHint ?? 'Drive it yourself, or let Forge run Plan → Build → Journal and step in whenever.')}
        </p>
      </div>
      {running ? (
        <Button size="sm" variant="secondary" onClick={onStop} leftIcon={<Square />}>
          Stop &amp; take over
        </Button>
      ) : (
        <Button size="sm" onClick={onRun} disabled={disabled} leftIcon={<Bot />}>
          Run automated
        </Button>
      )}
    </div>
  );
}
