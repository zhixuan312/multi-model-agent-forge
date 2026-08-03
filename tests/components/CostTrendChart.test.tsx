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
