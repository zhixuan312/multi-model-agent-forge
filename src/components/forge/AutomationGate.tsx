'use client';

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter, useSelectedLayoutSegment } from 'next/navigation';
import type { ProjectActivityEvent } from '@/activity/project-activity';
import { AutomationOverlay } from '@/components/forge/AutomationOverlay';

/** Stage kind → its route segment (inverse of LiveStageStepper's SEGMENT_TO_STAGE). */
const STAGE_TO_SEGMENT: Record<string, string> = {
  exploration: 'explore',
  spec: 'spec',
  plan: 'plan',
  execute: 'execute',
  review: 'review',
  journal: 'reflect',
};

/**
 * Whether automation is running is SERVER state (`project.autoMode`). `autoOverride`
 * is the optimistic window around a toggle: `true` between clicking "Run automated"
 * and the server confirming, `false` between clicking "Stop & take over" and the same,
 * `null` the rest of the time (follow the server).
 *
 * It has to be tri-state. When it was a plain boolean, consumers computed
 * `serverAuto || override`, so an optimistic STOP could never win while the server
 * still said `autoMode: true` — pressing Stop did nothing until the refresh landed.
 *
 * `viewOpen` is unrelated: the read-only activity log, which can be opened on a
 * project that isn't automating and must NOT swap the palette.
 */
let autoOverride: boolean | null = null;
let viewOpen = false;
let viewOnly = false;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export const automationOverlayStore = {
  getOverride: () => autoOverride,
  isViewOpen: () => viewOpen,
  isViewOnly: () => viewOnly,
  /** Optimistically START automation (overlay + 3-2-1 countdown + cool palette). */
  show: () => { viewOnly = false; autoOverride = true; emit(); },
  /** Open the overlay READ-ONLY to view a project's activity log (no countdown,
   * no automation started) — how a completed project shows its full record. */
  view: () => { viewOnly = true; viewOpen = true; emit(); },
  /** Optimistically STOP automation, and close the read-only log. */
  hide: () => { autoOverride = false; viewOnly = false; viewOpen = false; emit(); },
  /** Drop the override once the server agrees, so later server changes are seen. */
  clearOverride: () => { if (autoOverride !== null) { autoOverride = null; emit(); } },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

/**
 * The single source of truth for "is Forge driving right now?" — server state with the
 * optimistic override applied. `AutomationGate` uses it to swap the stage for the overlay
 * and `PhaseFromRoute` uses it to swap the palette warm→cool, so the two can never disagree.
 */
export function useAutomationRunning(serverAuto: boolean): boolean {
  const override = useSyncExternalStore(
    automationOverlayStore.subscribe,
    automationOverlayStore.getOverride,
    () => null as boolean | null,
  );
  // Once the server catches up to the optimistic value, stop overriding — otherwise a
  // stale `false` would mask automation later restarted by a loop or another user.
  useEffect(() => {
    if (override !== null && override === serverAuto) automationOverlayStore.clearOverride();
  }, [override, serverAuto]);
  return override ?? serverAuto;
}

interface Props {
  projectId: string;
  projectName: string;
  autoMode: boolean;
  autoNote: string;
  currentStage: string;
  phase: string;
  stagePhase?: string;
  automationStartedAt?: string;
  events?: ProjectActivityEvent[];
  children: ReactNode;
}

export function AutomationGate({ projectId, projectName, autoMode, autoNote, currentStage, phase, stagePhase, automationStartedAt, events, children }: Props) {
  const running = useAutomationRunning(autoMode);
  const viewing = useSyncExternalStore(automationOverlayStore.subscribe, automationOverlayStore.isViewOpen, () => false);
  const showOverlay = running || viewing;

  // When automation ENDS, the gate re-renders children for whatever route the user was on when they
  // pressed "Run automated" — often several stages behind where automation finished (the overlay
  // hides the URL, and automation advances stages without navigating). Land the user on the stage
  // where it actually ended so they don't reappear on a stale, now-empty earlier stage.
  const router = useRouter();
  const seg = useSelectedLayoutSegment();
  const prevRunning = useRef(running);
  useEffect(() => {
    if (prevRunning.current && !running) {
      const targetSeg = STAGE_TO_SEGMENT[currentStage];
      if (targetSeg && targetSeg !== seg) router.push(`/projects/${projectId}/${targetSeg}`);
    }
    prevRunning.current = running;
  }, [running, currentStage, seg, projectId, router]);

  return showOverlay ? (
    <AutomationOverlay
      projectId={projectId}
      projectName={projectName}
      autoMode={autoMode}
      autoNote={autoNote}
      currentStage={currentStage}
      phase={phase}
      stagePhase={stagePhase}
      automationStartedAt={automationStartedAt}
      events={events}
    />
  ) : (
    <>{children}</>
  );
}
