'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { AutomationOverlay } from '@/components/forge/AutomationOverlay';

let overlayVisible = false;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export const automationOverlayStore = {
  get: () => overlayVisible,
  show: () => { if (!overlayVisible) { overlayVisible = true; emit(); } },
  hide: () => { if (overlayVisible) { overlayVisible = false; emit(); } },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

interface Props {
  projectId: string;
  projectName: string;
  autoMode: boolean;
  autoNote: string;
  currentStage: string;
  phase: string;
  children: ReactNode;
}

export function AutomationGate({ projectId, projectName, autoMode, autoNote, currentStage, phase, children }: Props) {
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
    />
  ) : (
    <>{children}</>
  );
}
