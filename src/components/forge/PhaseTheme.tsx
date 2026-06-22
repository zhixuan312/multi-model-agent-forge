import type { ReactNode } from 'react';

export type Phase = 'design' | 'build';

/**
 * Sets `data-phase` on a wrapper so the `@theme` token values swap between the
 * warm (design) and cool (build) worlds (`globals.css`). Components read
 * tokens and never branch on phase in JS. Spec 1 renders `design` only — no
 * project drives the phase yet — but the swap mechanism is real and tested.
 */
export function PhaseTheme({
  phase = 'design',
  children,
  className,
}: {
  phase?: Phase;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-phase={phase} className={className}>
      {children}
    </div>
  );
}
