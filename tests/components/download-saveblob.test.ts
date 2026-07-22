// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveBlob } from '@/components/forge/export/download';

// QA E#8 — revoking the object URL on the same tick as click() can cancel a large download.
describe('saveBlob defers URL revoke', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not revoke synchronously; revokes after a delay', () => {
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    saveBlob(new Blob(['data']), 'file.zip');
    expect(createURL).toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled(); // NOT on the same tick
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
