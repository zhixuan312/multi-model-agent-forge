import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodSelect } from '../../app/(app)/usage/PeriodSelect';

const push = vi.fn();
let params = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/usage',
  useSearchParams: () => params,
}));

beforeEach(() => {
  push.mockClear();
  params = new URLSearchParams();
});

/**
 * This was the one dropdown in the app that rendered the OS control — a native `<select>`
 * with its own hand-written border and focus ring, sitting beside toolbars built from
 * Radix triggers.
 */
describe('PeriodSelect', () => {
  it('is the governed Select, not a native dropdown', () => {
    const { container } = render(<PeriodSelect />);
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Period' })).toBeInTheDocument();
  });

  it('defaults to This month when the URL names no period', () => {
    render(<PeriodSelect />);
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('This month');
  });

  it('reflects the period already in the URL', () => {
    params = new URLSearchParams('period=90d');
    render(<PeriodSelect />);
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Last 90 days');
  });

  it('puts the chosen period in the URL, preserving the other params', async () => {
    params = new URLSearchParams('tab=loops');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<PeriodSelect />);
    await user.click(screen.getByRole('combobox', { name: 'Period' }));
    await user.click(await screen.findByRole('option', { name: 'All time' }));
    expect(push).toHaveBeenCalledWith('/usage?tab=loops&period=all');
  });
});
