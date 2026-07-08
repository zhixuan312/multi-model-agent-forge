import { render, screen } from '@testing-library/react';
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
});
