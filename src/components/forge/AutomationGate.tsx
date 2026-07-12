'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import type { ProjectActivityEvent } from '@/activity/project-activity';
import { AutomationOverlay } from '@/components/forge/AutomationOverlay';

let overlayVisible = false;
let viewOnly = false;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export const automationOverlayStore = {
  get: () => overlayVisible,
  isViewOnly: () => viewOnly,
  /** Open the overlay to START automation (with the 3-2-1 countdown). */
  show: () => { viewOnly = false; overlayVisible = true; emit(); },
  /** Open the overlay READ-ONLY to view a project's activity log (no countdown,
   * no automation started) — how a completed project shows its full record. */
  view: () => { viewOnly = true; overlayVisible = true; emit(); },
  hide: () => { if (overlayVisible) { overlayVisible = false; viewOnly = false; emit(); } },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

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
  const clientOverlay = useSyncExternalStore(automationOverlayStore.subscribe, automationOverlayStore.get, () => false);
  const showOverlay = autoMode || clientOverlay;

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
