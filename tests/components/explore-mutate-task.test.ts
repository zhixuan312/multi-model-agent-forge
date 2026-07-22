// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/components/ui/toast', () => ({ showToast: vi.fn() }));

import { mutateTask } from '@/components/forge/ExploreStageClient';
import { showToast } from '@/components/ui/toast';

// QA — Explore fan-out task add/edit/delete previously await fetch() with no res.ok check:
// a failure silently reverted (and add dropped the typed prompt). mutateTask guards it.
describe('mutateTask', () => {
  beforeEach(() => (showToast as ReturnType<typeof vi.fn>).mockClear());

  it('returns true and shows no toast on a 2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as never;
    expect(await mutateTask('/x', { method: 'POST' }, 'fail')).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('returns false and toasts on a rejected response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 400 })) as never;
    expect(await mutateTask('/x', { method: 'POST' }, 'Couldn’t add the task — try again.')).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Couldn’t add the task — try again.' }));
  });

  it('returns false and toasts on a network error', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('network'); }) as never;
    expect(await mutateTask('/x', { method: 'DELETE' }, 'fail')).toBe(false);
    expect(showToast).toHaveBeenCalled();
  });
});
