import { type ReactNode } from 'react';
import { StatusDashboard, type StatusDashboardProps } from '@/components/patterns/status-dashboard';

/**
 * StageShell — the master-detail preset of the Content Shell for project stages.
 *
 *   left (2/3)  = the governed LEFT PANEL   (DocumentShell · List · Table · Form)
 *   right (1/3) = the note, then the RIGHT PANEL box (StageNavigator + StageAdvance)
 *
 * It owns the split and nothing else. It deliberately does NOT build the rail from an item
 * array: every stage needs a header action, grouped sections, progress and check tiles, so
 * the rail is `StageNavigator` — a component, passed in.
 */
export interface StageShellProps {
  /** The rail note, above the right-panel box. */
  note?: ReactNode;
  /** The LEFT PANEL (2/3). Pass a governed left-panel component — DocumentShell, List,
   *  Table or Form. It already renders its own Card, so StageShell adds none. */
  children: ReactNode;
  /** The RIGHT PANEL (1/3) — the box. Pass `StageNavigator`, whose own `footer` carries the
   *  `StageAdvance` button. StageShell does not build the rail itself: every page needs
   *  header actions, grouped sections and check tiles, which a flat item array cannot express.
   *  Omit it on an empty / loading state, where there is nothing to navigate yet. */
  navigator?: ReactNode;
  /** Metric row above the split — forwarded to the Content Shell. */
  metrics?: StatusDashboardProps['metrics'];
  /** Column alignment — forwarded to the Content Shell. */
  align?: StatusDashboardProps['align'];
  /** Who owns the 2/3 column's scroll — see StatusDashboard. `inner` when one item fills
   *  the panel, `outer` when it stacks several cards. */
  scroll?: StatusDashboardProps['scroll'];
  /** Extra className for the outer grid. */
  className?: string;
}

export function StageShell({ note, children, navigator, metrics, align, scroll, className }: StageShellProps) {
  return (
    <StatusDashboard
      className={className}
      metrics={metrics}
      align={align}
      scroll={scroll}
      // LEFT — the governed left panel (2/3). NOT wrapped in a Card: the component passed in
      // already is one, and a second would double-frame it.
      primary={children}
      // RIGHT — note above, then the navigator box (1/3).
      aside={
        <>
          {note}
          {navigator}
        </>
      }
    />
  );
}
