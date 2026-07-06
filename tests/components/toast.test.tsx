import { vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Toast behavior (spec §4.3, T-1..T-5). A fresh module per test isolates the singleton
// `items` array so toasts don't leak across cases.

let showToast: typeof import('@/components/ui/toast').showToast;
let Toaster: typeof import('@/components/ui/toast').Toaster;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  ({ showToast, Toaster } = await import('@/components/ui/toast'));
});
afterEach(() => {
  vi.useRealTimers();
});

function renderToaster() {
  return render(<Toaster />);
}

describe('Toast — auto-dismiss (T-1)', () => {
  it('error auto-dismisses after 5s by default', () => {
    renderToaster();
    act(() => { showToast({ type: 'error', message: 'Reverted.' }); });
    expect(screen.getByText('Reverted.')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4999); });
    expect(screen.queryByText('Reverted.')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.queryByText('Reverted.')).not.toBeInTheDocument();
  });

  it('success auto-dismisses after 3s', () => {
    renderToaster();
    act(() => { showToast({ type: 'success', message: 'Saved.' }); });
    act(() => { vi.advanceTimersByTime(2999); });
    expect(screen.queryByText('Saved.')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });

  it('durationMs override controls the timer', () => {
    renderToaster();
    act(() => { showToast({ type: 'error', message: 'Quick.', durationMs: 1000 }); });
    act(() => { vi.advanceTimersByTime(1050); });
    expect(screen.queryByText('Quick.')).not.toBeInTheDocument();
  });

  it('durationMs:0 persists (no auto-dismiss)', () => {
    renderToaster();
    act(() => { showToast({ type: 'error', message: 'Sticky.', durationMs: 0 }); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.queryByText('Sticky.')).toBeInTheDocument();
  });
});

describe('Toast — countdown sliver (T-2)', () => {
  it('renders a countdown element for an auto-dismissing toast', () => {
    const { container } = renderToaster();
    act(() => { showToast({ type: 'error', message: 'With bar.' }); });
    expect(container.querySelector('[data-toast-countdown]')).not.toBeNull();
  });

  it('renders no countdown element for a persistent toast', () => {
    const { container } = renderToaster();
    act(() => { showToast({ type: 'error', message: 'No bar.', durationMs: 0 }); });
    expect(container.querySelector('[data-toast-countdown]')).toBeNull();
  });
});

describe('Toast — retry (T-3) & roles (T-5)', () => {
  it('error toast carries role=alert and a Retry button that fires the callback', () => {
    const retry = vi.fn();
    renderToaster();
    act(() => { showToast({ type: 'error', message: 'Failed.', retry }); });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Failed.');
    act(() => { screen.getByRole('button', { name: /retry/i }).click(); });
    expect(retry).toHaveBeenCalledOnce();
  });

  it('success toast carries role=status', () => {
    renderToaster();
    act(() => { showToast({ type: 'success', message: 'Done.' }); });
    expect(screen.getByRole('status')).toHaveTextContent('Done.');
  });

  it('Retry stays available for the full lifetime of an auto-dismissing error toast', () => {
    const retry = vi.fn();
    renderToaster();
    act(() => { showToast({ type: 'error', message: 'Failed.', retry }); });
    act(() => { vi.advanceTimersByTime(4000); }); // still within the 5s window
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
