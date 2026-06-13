'use client';

import { useSyncExternalStore } from 'react';
import type { JournalNode } from '@/journal/types';

/**
 * A tiny client-side store for learnings recorded this session via the journal's
 * "Record a learning" dialog. The /journal viewer reads its nodes server-side
 * (the MMA journal store is read-only here), so newly recorded learnings live in
 * this store and are merged into the Nodes list + detail. Ephemeral by design —
 * a real backend would POST to the journal-record route.
 */
let items: JournalNode[] = [];
const listeners = new Set<() => void>();
const EMPTY: JournalNode[] = [];

export const recordedStore = {
  get: (): JournalNode[] => items,
  add: (node: JournalNode): void => {
    items = [node, ...items];
    for (const l of listeners) l();
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** Subscribe to the session-recorded learnings (newest first; [] on the server). */
export function useRecordedLearnings(): JournalNode[] {
  return useSyncExternalStore(recordedStore.subscribe, recordedStore.get, () => EMPTY);
}
