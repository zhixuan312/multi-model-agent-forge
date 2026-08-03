'use client';

import { useCallback, useState } from 'react';

/**
 * One expanded row at a time, for a `DataTable` with `expandedId` / `renderExpanded`.
 *
 * Clicking the open row closes it; clicking another row moves the expansion. The three
 * usage tables each carried a character-for-character copy of this, so a change to the
 * behaviour (say, allowing several rows open at once) meant finding all three.
 *
 * The setter is stable, so callers can list it in a `useMemo` dependency array for their
 * column definitions without rebuilding them on every render.
 */
export function useExpandedRow(): {
  expandedId: string | null;
  toggle: (id: string) => void;
} {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // `toggle(expandedId)` already collapses the open row, so a separate `close()` was a
  // second way to do one thing. All three tables destructure `{ expandedId, toggle }`;
  // nothing outside its own test ever called it.
  const toggle = useCallback((id: string) => setExpandedId((prev) => (prev === id ? null : id)), []);
  return { expandedId, toggle };
}
