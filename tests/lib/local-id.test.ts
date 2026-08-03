// @vitest-environment node
import { localId } from '@/lib/local-id';

/**
 * Both stage clients minted optimistic-message ids as `tmp-${Date.now()}`, which collides
 * for two sends inside the same millisecond. That id is a React key AND the handle used to
 * swap the optimistic row for the server's reply, so a collision reconciles the wrong
 * message — the failure is silent and looks like a lost send.
 */
describe('localId', () => {
  it('never repeats, even called in a tight loop within one millisecond', () => {
    const ids = Array.from({ length: 1000 }, () => localId('tmp'));
    expect(new Set(ids).size).toBe(1000);
  });

  it('keeps the caller-supplied prefix so ids stay readable in the DOM', () => {
    expect(localId('tmp')).toMatch(/^tmp-\d+$/);
    expect(localId('pm')).toMatch(/^pm-\d+$/);
  });

  it('defaults the prefix rather than producing a bare number', () => {
    expect(localId()).toMatch(/^local-\d+$/);
  });
});
