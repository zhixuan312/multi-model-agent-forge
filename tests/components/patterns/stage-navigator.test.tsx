import { render, screen, fireEvent } from '@testing-library/react';
import { StageNavigator, type NavGroup } from '@/components/patterns/stage-navigator';

/**
 * The right panel's box: title + optional header action, progress, grouped items with check
 * tiles, and an advance footer. This is the behaviour that used to live inside StageShell's
 * hand-built rail, and that every project stage hand-rolled for itself.
 */
const groups: NavGroup[] = [
  {
    id: 'g1',
    label: 'Decision',
    items: [
      { id: '1', title: 'Investigate backend', meta: 'Survey config files', index: 1, done: true },
      { id: '2', title: 'Research best practices', meta: 'Web search', index: 2, active: true },
    ],
  },
  { id: 'g2', label: 'Process', items: [{ id: '3', title: 'Journal recall', index: 3 }] },
];

describe('StageNavigator', () => {
  it('renders the title and every item', () => {
    render(<StageNavigator title="Tasks" groups={groups} />);
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Investigate backend')).toBeInTheDocument();
    expect(screen.getByText('Research best practices')).toBeInTheDocument();
    expect(screen.getByText('Journal recall')).toBeInTheDocument();
  });

  it('renders section headers above each cluster', () => {
    render(<StageNavigator title="Tasks" groups={groups} />);
    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText('Process')).toBeInTheDocument();
  });

  it('highlights the active item', () => {
    const { container } = render(<StageNavigator title="Tasks" groups={groups} />);
    const active = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Research best practices'),
    );
    expect(active?.className).toContain('border-accent');
  });

  it('calls the item handler when clicked', () => {
    const onClick = vi.fn();
    const withHandler: NavGroup[] = [{ id: 'g', items: [{ id: '1', title: 'Pick me', onClick }] }];
    render(<StageNavigator title="Tasks" groups={withHandler} />);
    fireEvent.click(screen.getByText('Pick me'));
    expect(onClick).toHaveBeenCalled();
  });

  it('shows progress as value over total', () => {
    render(<StageNavigator title="Tasks" groups={groups} progress={{ value: 1, total: 3 }} />);
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('renders the header action and the advance footer', () => {
    render(
      <StageNavigator
        title="Tasks"
        groups={groups}
        action={<button>Approve all</button>}
        footer={<button>Continue</button>}
      />,
    );
    expect(screen.getByText('Approve all')).toBeInTheDocument();
    expect(screen.getByText('Continue')).toBeInTheDocument();
  });

  it('renders a rich node as the meta line (a status chip, not just text)', () => {
    // Explore's rail puts the prompt in the title and the run status in the meta row, so
    // meta has to carry an element rather than a string.
    const groups: NavGroup[] = [{
      id: 'g',
      items: [{ id: '1', title: 'How is the backend configured?', meta: <span data-testid="chip">recorded</span> }],
    }];
    render(<StageNavigator title="Tasks" groups={groups} />);
    expect(screen.getByTestId('chip')).toBeInTheDocument();
    expect(screen.getByText('How is the backend configured?')).toBeInTheDocument();
  });

  it('centres the check tile against the title + meta stack', () => {
    // The row is a two-column table: tile in one cell, the two-row stack in the other. The
    // tile must centre against the stack, not pin to the first line.
    const groups: NavGroup[] = [{ id: 'g', items: [{ id: '1', title: 'Two line title here', meta: 'status' }] }];
    const { container } = render(<StageNavigator title="Tasks" groups={groups} showChecks />);
    const row = container.querySelector('button.rounded-\\[var\\(--r-md\\)\\]') ?? container.querySelector('button');
    expect(row?.className).toContain('items-center');
    expect(row?.className).not.toContain('items-start');
  });

  it('clamps the title so rows keep a uniform height', () => {
    const groups: NavGroup[] = [{ id: 'g', items: [{ id: '1', title: 'x'.repeat(400) }] }];
    const { container } = render(<StageNavigator title="Tasks" groups={groups} />);
    expect(container.querySelector('p.line-clamp-2')).not.toBeNull();
  });

  it('shows an empty state when no group has items', () => {
    render(<StageNavigator title="Tasks" groups={[{ id: 'g', items: [] }]} />);
    expect(screen.getByText('No items yet.')).toBeInTheDocument();
  });
});
