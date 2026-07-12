import { describe, expect, it } from 'vitest';

describe('legacy details.events writers removed', () => {
  it('does not export resolveRunningEventInPlace anymore', async () => {
    const mod = await import('@/automation/details-mutations');
    expect('resolveRunningEventInPlace' in mod).toBe(false);
  });

  it('does not export appendProjectEvent or resolveRunningEvent anymore', async () => {
    const mod = await import('@/details/write');
    expect('appendProjectEvent' in mod).toBe(false);
    expect('resolveRunningEvent' in mod).toBe(false);
  });
});
