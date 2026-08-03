import { type ReactNode } from 'react';

/**
 * One label/value row in a stats column — a hairline-separated pair, label muted on the
 * left, value emphasised on the right.
 *
 * This existed twice, in AutomationOverlay and ExecuteStageClient, with identical container
 * and value markup; the only difference was that one supported a leading icon and the other
 * did not. Two copies of a six-line row is how the two surfaces end up not matching.
 *
 * Distinct from `StatCard`'s internal rows in patterns/cards.tsx: those sit inside a card
 * body at a different scale and carry no separator.
 */
export function Stat({
  label,
  value,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Decorative leading glyph. Omit for a plain row. */
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2 last:border-0">
      <span className="flex items-center gap-1.5 text-xs text-ink-faint">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
