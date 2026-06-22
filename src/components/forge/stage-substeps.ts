'use client';

import { useSyncExternalStore } from 'react';
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
  // DESIGN
  exploration: [
    { key: 'scope', label: 'Scope' },
    { key: 'discover', label: 'Discover' },
    { key: 'synthesize', label: 'Synthesize' },
  ],
  spec: [
    { key: 'outline', label: 'Outline' },
    // The section-by-section Q&A authoring — the soul of the app.
    { key: 'craft', label: 'Craft' },
    { key: 'document', label: 'Document' },
  ],
  plan: [
    { key: 'detail', label: 'Detail' },
    { key: 'validate', label: 'Validate' },
  ],
  // BUILD
  execute: [
    { key: 'configure', label: 'Configure' },
    { key: 'monitor', label: 'Monitor' },
  ],
  review: [
    { key: 'inspect', label: 'Inspect' },
    { key: 'judge', label: 'Judge' },
    { key: 'resolve', label: 'Resolve' },
  ],
  // LEARN
  journal: [
    { key: 'harvest', label: 'Harvest' },
    { key: 'curate', label: 'Curate' },
    { key: 'record', label: 'Record' },
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
