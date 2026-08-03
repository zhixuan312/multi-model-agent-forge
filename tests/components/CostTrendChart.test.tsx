import { render, screen, within } from '@testing-library/react';
import { CostTrendChart } from '../../app/(app)/usage/CostTrendChart';

const day = (date: string, costUsd: number, savedUsd: number, count: number) => ({ date, costUsd, savedUsd, count });

describe('CostTrendChart', () => {
  it('renders an area + line + volume bars for a multi-day series', () => {
    const { container } = render(
      <CostTrendChart
        points={[day('2026-07-01', 40, 20, 12), day('2026-07-02', 21, 10, 8), day('2026-07-03', 90, 50, 30)]}
      />,
    );
    // the cost line (a <path>) and volume bars (<rect>) are drawn
    expect(container.querySelector('path[data-role="cost-line"]')).toBeInTheDocument();
    expect(container.querySelectorAll('rect[data-role="volume-bar"]').length).toBe(3);
  });

  /**
   * The axis built its gridline values by accumulating `v += step`, which compounds binary
   * float error. It reaches sub-dollar steps BY CONSTRUCTION — `niceScale` is called as
   * `niceScale(Math.max(1, …costs))`, so any team spending under a dollar gets step 0.2 —
   * and the third gridline rendered as `$0.6000000000000001`. Usage is denominated in
   * cents for most teams, so this was the common case, not an edge one.
   */
  it('renders clean money on the y-axis, at every scale', () => {
    const labelsFor = (max: number): string[] => {
      const { container, unmount } = render(
        <CostTrendChart points={[day('2026-07-01', 0, 0, 1), day('2026-07-02', max, 0, 1)]} />,
      );
      const out = [...container.querySelectorAll('text')]
        .map((t) => t.textContent ?? '')
        .filter((t) => t.startsWith('$'));
      unmount();
      return out;
    };

    expect(labelsFor(0.4)).toEqual(['$0', '$0.2', '$0.4', '$0.6', '$0.8', '$1']);
    expect(labelsFor(2.5)).toEqual(['$0', '$0.5', '$1', '$1.5', '$2', '$2.5']);

    for (const max of [0.05, 0.4, 1, 1.5, 2.5, 7, 12, 130]) {
      for (const label of labelsFor(max)) {
        // A money label is a few significant digits; `$0.6000000000000001` is 19 chars.
        expect(label.length, `max=${max} produced ${label}`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('shows a needs-more-history message for a single day', () => {
    render(<CostTrendChart points={[day('2026-07-01', 40, 20, 12)]} />);
    expect(screen.getByText(/at least two days/i)).toBeInTheDocument();
  });

  it('renders nothing meaningful for an empty series (no bars)', () => {
    const { container } = render(<CostTrendChart points={[]} />);
    expect(container.querySelectorAll('rect[data-role="volume-bar"]').length).toBe(0);
  });

  /**
   * The picture exposed one `aria-label` and no numbers, and the only surface carrying
   * them is a tooltip driven by `onMouseMove` — unreachable by keyboard entirely. The
   * SVG is decorative now and the same data is a real table beside it.
   */
  it('exposes every point as data, not just a picture', () => {
    render(
      <CostTrendChart
        points={[day('2026-07-01', 40, 20, 12), day('2026-07-02', 21, 0, 8)]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Daily cost and dispatch volume' });
    expect(within(table).getByRole('rowheader', { name: '2026-07-01' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: '2026-07-02' })).toBeInTheDocument();
    // one header row + one row per point
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('does not announce the decorative SVG as a second copy of the data', () => {
    const { container } = render(
      <CostTrendChart points={[day('2026-07-01', 40, 20, 12), day('2026-07-02', 21, 0, 8)]} />,
    );
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
