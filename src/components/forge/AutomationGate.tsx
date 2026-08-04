'use client';

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter, useSelectedLayoutSegment } from 'next/navigation';
import type { ProjectActivityEvent } from '@/activity/project-activity';
import { AutomationOverlay } from '@/components/forge/AutomationOverlay';
import { automationOverlayStore, useAutomationRunning } from '@/components/forge/automation-overlay-store';
import { STAGE_ROUTE } from '@/projects/stage-route';
import type { StageKind } from '@/db/enums';

interface Props {
  projectId: string;
  autoMode: boolean;
  /**
   * The stage automation is on, or `null` when the project has neither an active stage nor
   * a recorded `current_stage`. The layout used to substitute `'spec'` there — an invented
   * answer that this component then pushed the browser to, and the project index page
   * answers the same question with `'exploration'`. `null` means "nowhere to land", which
   * is what the redirect below now does with it.
   */
  currentStage: StageKind | null;
  automationStartedAt?: string;
  events?: ProjectActivityEvent[];
  children: ReactNode;
}

export function AutomationGate({ projectId, autoMode, currentStage, automationStartedAt, events, children }: Props) {
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
      const targetSeg = currentStage ? STAGE_ROUTE[currentStage] : null;
      if (targetSeg && targetSeg !== seg) router.push(`/projects/${projectId}/${targetSeg}`);
    }
    prevRunning.current = running;
  }, [running, currentStage, seg, projectId, router]);

  return showOverlay ? (
    <AutomationOverlay
      projectId={projectId}
      autoMode={autoMode}
      currentStage={currentStage}
      automationStartedAt={automationStartedAt}
      events={events}
    />
  ) : (
    <>{children}</>
  );
}
