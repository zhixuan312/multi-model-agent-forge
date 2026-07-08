import { render } from '@testing-library/react';
import { Sparkline } from '../../app/(app)/usage/Sparkline';

describe('Sparkline', () => {
  it('renders a polyline for a multi-point series', () => {
    const { container } = render(<Sparkline points={[1, 4, 2, 8]} />);
    const line = container.querySelector('polyline');
    expect(line).toBeInTheDocument();
    // one coordinate pair per point
    expect((line?.getAttribute('points') ?? '').trim().split(/\s+/)).toHaveLength(4);
  });

  it('renders nothing for an empty series', () => {
    const { container } = render(<Sparkline points={[]} />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});
