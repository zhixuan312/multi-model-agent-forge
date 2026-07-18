import { render, screen } from '@testing-library/react';
import { StageShell } from '@/components/patterns/stage-shell';

/**
 * StageShell owns the 2/3 ∣ 1/3 split and nothing else: the left panel is whatever governed
 * component the page passes, and the rail is `note` + a `navigator` node. The rail's own
 * behaviour (items, selection, progress, checks) is covered in stage-navigator.test.tsx.
 */
describe('StageShell', () => {
  it('renders the left panel content', () => {
    render(
      <StageShell navigator={<div>Rail</div>}>
        <p>Selected task detail</p>
      </StageShell>,
    );
    expect(screen.getByText('Selected task detail')).toBeInTheDocument();
  });

  it('renders the navigator in the rail', () => {
    render(
      <StageShell navigator={<div>Tasks navigator</div>}>
        <p>Detail</p>
      </StageShell>,
    );
    expect(screen.getByText('Tasks navigator')).toBeInTheDocument();
  });

  it('renders the note above the navigator', () => {
    render(
      <StageShell note={<div>Guidance note</div>} navigator={<div>Navigator</div>}>
        <p>Detail</p>
      </StageShell>,
    );
    const note = screen.getByText('Guidance note');
    const nav = screen.getByText('Navigator');
    // The note precedes the navigator box in document order.
    expect(note.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not wrap the left panel in a Card of its own', () => {
    // The governed left-panel component already renders a Card; a second one would
    // double-frame it, which is the bug this shape prevents.
    render(
      <StageShell navigator={<div>Rail</div>}>
        <section data-testid="left-panel">Detail</section>
      </StageShell>,
    );
    const panel = screen.getByTestId('left-panel');
    expect(panel.parentElement).not.toBeNull();
    expect(panel.parentElement!.className).not.toContain('rounded-[var(--r-lg)]');
  });
});
