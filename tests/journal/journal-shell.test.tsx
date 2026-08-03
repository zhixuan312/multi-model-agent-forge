import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useJournalNodeBody } from '@/components/forge/journal/journal-shell';

const NODE_A = { node: { id: '0001', crux: 'A crux', context: 'A ctx', consequences: 'A cons' }, inbound: [] };
const NODE_B = { node: { id: '0002', crux: 'B crux', context: 'B ctx', consequences: 'B cons' }, inbound: [] };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({ ok: true, json: async () => (url.endsWith('0001') ? NODE_A : NODE_B) }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('useJournalNodeBody', () => {
  it('loads a node body', async () => {
    const { result } = renderHook(({ id }) => useJournalNodeBody(id), { initialProps: { id: '0001' as string | null } });
    expect(result.current.phase).toBe('loading');
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current).toMatchObject({ node: { context: 'A ctx' } });
  });

  /**
   * The load-bearing case. The graph mounts its reading panel on `full && selected` and
   * asks this hook for the same pair, so a hook that only reset inside its effect handed
   * back the PREVIOUS node's Context and Consequences under the new node's title for the
   * frame before the effect ran.
   */
  it('never returns the previous node for a new id, not even for one render', async () => {
    const { result, rerender } = renderHook(({ id }) => useJournalNodeBody(id), {
      initialProps: { id: '0001' as string | null },
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({ id: '0002' });
    // Synchronously — no await. This is the frame the panel rendered stale data in.
    expect(result.current.phase).toBe('loading');

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current).toMatchObject({ node: { context: 'B ctx' } });
  });

  it('goes back to loading when the id becomes null, keeping nothing stale', async () => {
    const { result, rerender } = renderHook(({ id }) => useJournalNodeBody(id), {
      initialProps: { id: '0001' as string | null },
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({ id: null });
    expect(result.current.phase).toBe('loading');
    expect(result.current).not.toMatchObject({ node: { context: 'A ctx' } });
  });

  it('fetches nothing at all for a null id', () => {
    renderHook(() => useJournalNodeBody(null));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces a failed load as error, not a permanent spinner', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    const { result } = renderHook(() => useJournalNodeBody('0009'));
    await waitFor(() => expect(result.current.phase).toBe('error'));
  });
});
