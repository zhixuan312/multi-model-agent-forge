'use client';

import { ArrowRight, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * StageAdvance — the ONE canonical "leave this stage for the next" control,
 * shared across every cross-stage handoff (Explore→Spec→Plan→Execute→Review→
 * Journal). Dark-ink filled, right ArrowRight, full-width; the DESIGN→BUILD gate
 * adds a Lock glyph. In-stage phase moves stay ember (Button) — dark-ink means
 * "commit forward to the next stage". Renders an <a> (href) or a <button>
 * (onClick, e.g. the lock-then-navigate gate).
 */
export function StageAdvance({
  href,
  onClick,
  label,
  disabled = false,
  gate = false,
  testId,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  disabled?: boolean;
  /** DESIGN→BUILD gate — shows a Lock glyph. */
  gate?: boolean;
  testId?: string;
}) {
  const cls = cn(
    'inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--r)] px-4 py-2 text-sm font-medium transition-colors',
    disabled ? 'pointer-events-none cursor-not-allowed bg-surface-2 text-ink-faint' : 'bg-ink text-white hover:bg-ink/90',
  );
  const inner = (
    <>
      {gate ? <Lock aria-hidden="true" className="size-4" /> : null}
      {label}
      <ArrowRight aria-hidden="true" className="size-4" />
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={cls} data-testid={testId}>
        {inner}
      </button>
    );
  }
  return (
    <a href={disabled ? undefined : href} aria-disabled={disabled} data-testid={testId} className={cls}>
      {inner}
    </a>
  );
}
