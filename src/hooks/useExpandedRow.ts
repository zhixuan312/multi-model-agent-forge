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
  close: () => void;
} {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = useCallback((id: string) => setExpandedId((prev) => (prev === id ? null : id)), []);
  const close = useCallback(() => setExpandedId(null), []);
  return { expandedId, toggle, close };
}
