import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StageAdvance } from '@/components/forge/StageAdvance';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

beforeEach(() => { push.mockClear(); refresh.mockClear(); });

/**
 * The stage-to-stage advance posts /transition and may be REJECTED (spec/plan
 * sign-off gate, single-flight lease, invariant repair). It must NOT navigate
 * forward on a rejected transition — routing to the next stage without an actual
 * advance is the read-a-half-advanced-project bug the unified engine exists to kill.
 */
describe('StageAdvance — never navigates on a rejected transition', () => {
  it('does NOT push and surfaces the error when /transition returns 409', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'auto is driving — take over first' }), { status: 409 }),
    );
    render(<StageAdvance href="/projects/p/plan" label="Continue to Plan" projectId="p" from="spec" />);

    fireEvent.click(screen.getByRole('button', { name: /Continue to Plan/ }));

    await waitFor(() => expect(screen.getByText(/auto is driving/)).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith('/api/projects/p/transition', expect.objectContaining({ method: 'POST' }));
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does NOT push on a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    render(<StageAdvance href="/projects/p/plan" label="Continue to Plan" projectId="p" from="spec" />);

    fireEvent.click(screen.getByRole('button', { name: /Continue to Plan/ }));

    await waitFor(() => expect(screen.getByText(/Network error/)).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });

  it('navigates forward only when the transition succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<StageAdvance href="/projects/p/plan" label="Continue to Plan" projectId="p" from="spec" />);

    fireEvent.click(screen.getByRole('button', { name: /Continue to Plan/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p/plan'));
    expect(refresh).toHaveBeenCalled();
  });
});
