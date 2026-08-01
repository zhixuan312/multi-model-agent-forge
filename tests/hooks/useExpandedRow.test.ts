// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExpandedRow } from '@/hooks/useExpandedRow';

/**
 * The three usage tables each carried a character-for-character copy of this expand/collapse
 * state, so changing the behaviour meant finding all three. These lock the shared contract.
 */
describe('useExpandedRow', () => {
  it('starts with nothing expanded', () => {
    const { result } = renderHook(() => useExpandedRow());
    expect(result.current.expandedId).toBeNull();
  });

  it('expands a row, and toggling the SAME row collapses it', () => {
    const { result } = renderHook(() => useExpandedRow());
    act(() => result.current.toggle('a'));
    expect(result.current.expandedId).toBe('a');
    act(() => result.current.toggle('a'));
    expect(result.current.expandedId).toBeNull();
  });

  it('moves the expansion when a DIFFERENT row is toggled — one open at a time', () => {
    const { result } = renderHook(() => useExpandedRow());
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('b'));
    expect(result.current.expandedId).toBe('b');
  });

  it('close() collapses whatever is open, and is safe when nothing is', () => {
    const { result } = renderHook(() => useExpandedRow());
    act(() => result.current.toggle('a'));
    act(() => result.current.close());
    expect(result.current.expandedId).toBeNull();
    act(() => result.current.close());
    expect(result.current.expandedId).toBeNull();
  });

  it('keeps stable callback identities across renders', () => {
    // The tables list `toggle` in the dependency array of the useMemo that builds their
    // columns; an unstable identity would rebuild every column on every render.
    const { result, rerender } = renderHook(() => useExpandedRow());
    const first = { toggle: result.current.toggle, close: result.current.close };
    rerender();
    expect(result.current.toggle).toBe(first.toggle);
    expect(result.current.close).toBe(first.close);
  });
});
