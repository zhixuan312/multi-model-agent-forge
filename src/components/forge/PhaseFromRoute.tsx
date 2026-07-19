'use client';

import type { ReactNode } from 'react';
import { useAutomationRunning } from '@/components/forge/AutomationGate';

/**
 * Swaps the project shell between the warm `design` palette and the cool `build`
 * palette by setting `data-phase` (see globals.css → [data-phase="build"]).
 *
 * `auto` is the server's `project.autoMode`. It resolves through `useAutomationRunning`
 * — the same seam `AutomationGate` uses to decide whether to show the overlay — so the
 * palette and the overlay flip together on both edges of the toggle: cool the instant
 * "Run automated" is pressed, warm the instant "Stop & take over" is.
 *
 * This was previously driven by a store only `AutomationBar` wrote to — but the bar
 * unmounts the moment automation starts (the gate replaces the whole stage), so the
 * build palette could never actually be reached.
 */
export function PhaseFromRoute({ auto, children }: { auto: boolean; children: ReactNode }) {
  const running = useAutomationRunning(auto);
  return <div data-phase={running ? 'build' : 'design'} className="contents">{children}</div>;
}
