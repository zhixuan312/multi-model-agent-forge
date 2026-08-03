'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The stepper's live sub-phase channel. The sub-phase LIST lives in
 * `@/projects/stage-phases` (`STAGE_PHASES`) — it is also what each stage page validates
 * its `?phase=` against, and it was spelled out here as well until the two roles were
 * single-sourced. This module owns only the *live* half: the active stage comes from the
 * route, but the active sub-phase is page state, so the page publishes it to this tiny
 * external store and the stepper subscribes.
 */
let current = '';
let navHandler: ((key: string) => void) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export const stagePhaseStore = {
  get: (): string => current,
  set: (v: string): void => {
    if (v === current) return;
    current = v;
    emit();
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** Request navigation to a sub-phase (no-op unless the active page registered a handler). */
  navigate: (key: string): void => navHandler?.(key),
  hasNavigator: (): boolean => navHandler !== null,
  /** The active page registers how to jump between its sub-phases; returns an unregister fn. */
  onNavigate: (h: (key: string) => void): (() => void) => {
    navHandler = h;
    emit();
    return () => {
      if (navHandler === h) {
        navHandler = null;
        emit();
      }
    };
  },
};

/** Subscribe to the active sub-phase key (empty on the server / before first publish). */
export function useStageSubPhase(): string {
  return useSyncExternalStore(stagePhaseStore.subscribe, stagePhaseStore.get, () => '');
}

/**
 * Publish the active sub-phase — to the stepper AND to the URL.
 *
 * Every project page reads `{stage}?phase={phase}`, so the phase must be in the URL
 * from the first paint, not only after someone clicks a sub-phase chip. Landing on a
 * stage used to give a bare `/reflect` until you interacted, which made the address
 * bar disagree with the stepper and made a phase unlinkable.
 *
 * `replace`, not `push`: normalising the address you already asked for is not a
 * separate history entry.
 */
export function useStagePhaseUrl(phase: string): void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => { stagePhaseStore.set(phase); }, [phase]);

  useEffect(() => {
    if (!phase || params.get('phase') === phase) return;
    const next = new URLSearchParams(params.toString());
    next.set('phase', phase);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [phase, params, pathname, router]);
}
