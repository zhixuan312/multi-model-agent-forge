import { render, screen } from '@testing-library/react';
import { FindingsGrid, FindingsApplyBar, appliedState, type Finding } from '@/components/patterns/findings';

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

describe('FindingsApplyBar label matches what the button will do', () => {
  const bar = (selectedCount: number, total = 3) =>
    render(
      <FindingsApplyBar
        selectedCount={selectedCount}
        total={total}
        onToggleAll={() => {}}
        onApply={() => {}}
      />,
    );

  it('is disabled with an empty selection, and does not claim it will apply "all"', () => {
    bar(0);
    const apply = screen.getByRole('button', { name: /^Apply/ });
    expect(apply).toBeDisabled();
    // It used to read "Apply (all)" while refusing to do anything.
    expect(apply).toHaveTextContent('Apply');
    expect(apply).not.toHaveTextContent('all');
  });

  it('names the number it will apply once something is selected', () => {
    bar(2);
    const apply = screen.getByRole('button', { name: 'Apply (2)' });
    expect(apply).toBeEnabled();
  });

  it('offers Select all until everything is selected, then Unselect all', () => {
    const { unmount } = bar(1, 3);
    expect(screen.getByRole('button', { name: 'Select all' })).toBeInTheDocument();
    unmount();
    bar(3, 3);
    expect(screen.getByRole('button', { name: 'Unselect all' })).toBeInTheDocument();
  });
});

describe('appliedState — a partial apply leaves the remainder actionable', () => {
  it('reports nothing applied for an untouched pass', () => {
    expect(appliedState(3, [])).toEqual({ someApplied: false, allApplied: false, remainingIndices: [0, 1, 2] });
  });

  it('reports a SUBSET as some-but-not-all, naming what is left', () => {
    // This is the case the Plan stage could not represent: it locked the whole pass, so the
    // un-applied findings became unreachable.
    expect(appliedState(3, [1])).toEqual({ someApplied: true, allApplied: false, remainingIndices: [0, 2] });
  });

  it('reports a fully-applied pass, which is what locks it', () => {
    expect(appliedState(3, [0, 1, 2])).toEqual({ someApplied: true, allApplied: true, remainingIndices: [] });
  });

  it('never claims allApplied for a pass with no findings', () => {
    // A clean pass has nothing to apply; calling it "applied" would lock an empty grid.
    expect(appliedState(0, [])).toEqual({ someApplied: false, allApplied: false, remainingIndices: [] });
  });

  it('tolerates duplicate or out-of-range indices without losing a remaining finding', () => {
    expect(appliedState(3, [1, 1])).toMatchObject({ allApplied: false, remainingIndices: [0, 2] });
  });
});
