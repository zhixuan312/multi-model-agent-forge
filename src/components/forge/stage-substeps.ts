'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { StageKind } from '@/db/enums';

/**
 * The sub-phases each stage advances through, surfaced inline in the (expandable)
 * StageStepper so "you are here" reads at both levels — stage and sub-phase. The
 * active stage comes from the route; the active *sub-phase* is live page state, so
 * the page publishes it to this tiny external store and the stepper subscribes.
 */
// Every stage marches the same three-beat rhythm — Frame → Work → Seal — and
// every phase is a single imperative verb, harmonised across all six stages.
export const STAGE_SUBSTEPS: Partial<Record<StageKind, { key: string; label: string }[]>> = {
  exploration: [
    { key: 'brief', label: 'Brief' },
    { key: 'discover', label: 'Discover' },
    { key: 'synthesize', label: 'Synthesize' },
  ],
  spec: [
    { key: 'outline', label: 'Outline' },
    { key: 'craft', label: 'Craft' },
    { key: 'finalize', label: 'Finalize' },
  ],
  plan: [
    { key: 'refine', label: 'Refine' },
    { key: 'validate', label: 'Validate' },
  ],
  execute: [
    { key: 'configure', label: 'Configure' },
    { key: 'implement', label: 'Implement' },
  ],
  review: [
    { key: 'review', label: 'Review' },
  ],
  journal: [
    { key: 'journal', label: 'Journal' },
    { key: 'summary', label: 'Summary' },
  ],
};

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

/** Whether the active page exposes sub-phase navigation (so the chips become clickable). */
export function useStageNavigable(): boolean {
  return useSyncExternalStore(stagePhaseStore.subscribe, stagePhaseStore.hasNavigator, () => false);
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
