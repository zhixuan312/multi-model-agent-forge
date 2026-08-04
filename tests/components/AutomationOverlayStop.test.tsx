// @vitest-environment jsdom
/**
 * Stop must not claim more than cancellation delivers.
 *
 * `take_over` clears auto-mode and asks MMA to cancel the in-flight batches, but
 * cancellation is COOPERATIVE: the engine finishes the step it already has, still committing
 * to the project branch. The overlay used to `hide()` on the click, which reads as "stopped"
 * — a user could close the tab believing nothing more would land.
 *
 * So the overlay stays, in `stopping`, until the batches it asked to cancel actually settle.
 * The two failure modes are opposite and both matter: hiding too early (the lie) and never
 * hiding at all (a project with nothing in flight, which is never acknowledged).
 */
import { vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AutomationOverlay } from '@/components/forge/AutomationOverlay';
import { automationOverlayStore } from '@/components/forge/AutomationGate';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/hooks/useProjectEvents', () => ({ useProjectEvents: () => {} }));

const hide = vi.spyOn(automationOverlayStore, 'hide');

function announce(type: string, batchId: string) {
  act(() => { window.dispatchEvent(new CustomEvent(type, { detail: { batchId } })); });
}

function renderOverlay() {
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;
  render(
    <AutomationOverlay projectId="p1" autoMode currentStage="spec" automationStartedAt={new Date().toISOString()} events={[]} />,
  );
  return screen.getByRole('button', { name: /Stop/i });
}

beforeEach(() => { hide.mockClear(); vi.useRealTimers(); });

describe('AutomationOverlay stop', () => {
  it('holds the overlay open while the cancelled work is still winding down', async () => {
    const stop = renderOverlay();
    act(() => { stop.click(); });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Stopping...' })).toBeInTheDocument());
    announce('automation:cancelling', 'b1');

    // The batch is known to be winding down — hiding now would be the original lie.
    expect(hide).not.toHaveBeenCalled();
    // And the button cannot be pressed again to "stop harder".
    expect(screen.getByRole('button', { name: /Stopping/i })).toBeDisabled();
  });

  it('hides once every acknowledged batch settles', async () => {
    const stop = renderOverlay();
    act(() => { stop.click(); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stopping...' })).toBeInTheDocument());

    announce('automation:cancelling', 'b1');
    announce('automation:cancelling', 'b2');
    announce('automation:dispatch_settled', 'b1');
    // One still outstanding — not yet.
    expect(hide).not.toHaveBeenCalled();

    announce('automation:dispatch_settled', 'b2');
    await waitFor(() => expect(hide).toHaveBeenCalled());
  });

  /**
   * A project with nothing in flight is never acknowledged, so waiting on an acknowledgement
   * would strand the overlay open. The grace timer covers exactly that case — and MUST NOT
   * fire once something has been acknowledged, or it would reintroduce the early hide.
   */
  it('closes out when nothing was in flight to cancel', async () => {
    vi.useFakeTimers();
    const stop = renderOverlay();
    act(() => { stop.click(); });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Stopping...' })).toBeInTheDocument());

    act(() => { vi.advanceTimersByTime(5000); });
    expect(hide).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not let the grace timer cut short a real cancellation', async () => {
    vi.useFakeTimers();
    const stop = renderOverlay();
    act(() => { stop.click(); });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Stopping...' })).toBeInTheDocument());

    announce('automation:cancelling', 'b1');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(hide, 'the grace timer hid the overlay while a batch was still cancelling').not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
