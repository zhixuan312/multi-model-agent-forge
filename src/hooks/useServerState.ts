'use client';

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * useServerState — drop-in replacement for useState when the initial value
 * comes from a server component prop.
 *
 * Problem: `useState(serverProp)` ignores updates to `serverProp` after mount.
 * When `router.refresh()` re-renders the server component with new data, the
 * client component keeps the stale state.
 *
 * Solution: track the server value via a ref. When it changes (detected by
 * reference equality during render), reset the state synchronously — no
 * extra render cycle, no useEffect timing issues.
 *
 * Usage:
 *   // Before (broken on refresh):
 *   const [items, setItems] = useState(props.initialItems);
 *
 *   // After (auto-syncs on refresh):
 *   const [items, setItems] = useServerState(props.initialItems);
 */
export function useServerState<T>(serverValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(serverValue);
  const prevRef = useRef(serverValue);
  if (prevRef.current !== serverValue) {
    prevRef.current = serverValue;
    setValue(serverValue);
  }
  return [value, setValue];
}
