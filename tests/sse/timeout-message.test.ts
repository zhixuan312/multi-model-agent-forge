// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FORGE_POLL_TIMEOUT_ERROR } from '@/sse/envelope';
import { POLL_HARD_TIMEOUT_MS } from '@/sse/poll-timing';

/**
 * The message a user sees when a task is force-failed must name the wait that actually
 * happened. It said "within 15m" as a literal while the real ceiling had moved to an
 * hour, so it described a timeout that never occurred.
 */
describe('the poll-timeout message names the real ceiling', () => {
  it('derives its duration from POLL_HARD_TIMEOUT_MS', () => {
    expect(FORGE_POLL_TIMEOUT_ERROR.message)
      .toBe(`no terminal envelope within ${Math.round(POLL_HARD_TIMEOUT_MS / 60_000)}m`);
  });

  it('states a duration that matches the constant in minutes', () => {
    const minutes = Number(/within (\d+)m/.exec(FORGE_POLL_TIMEOUT_ERROR.message)?.[1]);
    expect(minutes).toBe(POLL_HARD_TIMEOUT_MS / 60_000);
  });
});
