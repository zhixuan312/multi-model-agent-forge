'use client';

import type { ReactNode } from 'react';
import { useAppPhase } from '@/components/forge/app-phase';

/**
 * Shell-level palette scope. Sets `data-phase` for the WHOLE app (sidebar + global
 * chrome + content) from the active project's phase (published by `PhaseFromRoute`),
 * so the cool "build" world reaches the sidebar too — not only the content pane.
 * Replaces the hardcoded `<PhaseTheme phase="design">` at the app-shell root.
 */
export function AppPhaseTheme({ children, className }: { children: ReactNode; className?: string }) {
  const phase = useAppPhase();
  return (
    <div data-phase={phase} className={className}>
      {children}
    </div>
  );
}
