import { render, screen } from '@testing-library/react';
import { FindingsGrid, type Finding } from '@/components/patterns/findings';

const f = (severity: string, claim: string): Finding =>
  ({ severity, category: 'gap', claim } as Finding);

/**
 * `severity` arrives as a free-text `weight` from the engine, so an unexpected word reaches
 * these components. It used to sort ABOVE critical (raw `indexOf` returns -1) and render a
 * chip with no background.
 */
describe('FindingsGrid tolerates a severity outside the set', () => {
  it('sorts most-severe first', () => {
    render(<FindingsGrid findings={[f('low', 'L'), f('critical', 'C'), f('medium', 'M'), f('high', 'H')]} />);
    const rows = screen.getAllByRole('row').slice(1); // drop the header row
    expect(rows.map((r) => r.textContent?.match(/[CHML]/)?.[0])).toEqual(['C', 'H', 'M', 'L']);
  });

  it('places an unrecognised severity last, not first', () => {
    render(<FindingsGrid findings={[f('weird', 'W'), f('critical', 'C'), f('low', 'L')]} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent?.match(/[CLW]/)?.[0])).toEqual(['C', 'L', 'W']);
  });

  it('gives an unrecognised severity a visible tint rather than an unstyled chip', () => {
    render(<FindingsGrid findings={[f('weird', 'W')]} />);
    const chip = screen.getByText('weird');
    // The class list must carry a real background, not `undefined`.
    expect(chip.className).toMatch(/bg-/);
    expect(chip.className).not.toContain('undefined');
  });

  it('renders the empty state rather than a bare table when there are no findings', () => {
    render(<FindingsGrid findings={[]} />);
    expect(screen.getByText('No findings.')).toBeInTheDocument();
  });
});
