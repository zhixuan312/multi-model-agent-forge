'use client';

import { useSyncExternalStore } from 'react';
import type { Phase } from '@/components/forge/PhaseTheme';

/**
 * Broadcasts the ACTIVE project's phase (design ⇄ build) to the whole app shell.
 *
 * `PhaseFromRoute` resolves a project's running state and applies `data-phase` to the
 * content pane — but the sidebar and global chrome are siblings of that pane, so the
 * cool "build" palette never reached them. PhaseFromRoute now also publishes here, and
 * the shell-level themer (`AppPhaseTheme`) subscribes, so cold mode covers the sidebar
 * too. Pages without a project (Projects list, Loops, Journal…) mount no PhaseFromRoute,
 * so the store stays on the warm default 'design'.
 */
let phase: Phase = 'design';
const listeners = new Set<() => void>();

export const appPhaseStore = {
  get: (): Phase => phase,
  set: (p: Phase): void => {
    if (p === phase) return;
    phase = p;
    for (const l of listeners) l();
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** Subscribe to the active project's phase (warm 'design' on the server / before publish). */
export function useAppPhase(): Phase {
  return useSyncExternalStore(appPhaseStore.subscribe, appPhaseStore.get, () => 'design');
}
