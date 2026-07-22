import { render } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { RunLivePoll } from '../../app/(app)/loops/RunLivePoll';

// QA F11 — the loop run history must live-update while a run is in progress.
describe('RunLivePoll', () => {
  beforeEach(() => { refresh.mockClear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('refreshes the server component on an interval while a run is active', () => {
    render(<RunLivePoll active intervalMs={1000} />);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('does not poll when the run is not active (terminal)', () => {
    render(<RunLivePoll active={false} intervalMs={1000} />);
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
