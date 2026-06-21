'use client';

import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

let autoRunning = false;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export const automationThemeStore = {
  get: () => autoRunning,
  set: (v: boolean) => { if (v !== autoRunning) { autoRunning = v; emit(); } },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

export function PhaseFromRoute({ children }: { children: ReactNode }) {
  const isAuto = useSyncExternalStore(automationThemeStore.subscribe, automationThemeStore.get, () => false);
  return <div data-phase={isAuto ? 'build' : 'design'} className="contents">{children}</div>;
}
