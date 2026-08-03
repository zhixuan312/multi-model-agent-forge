import { render, screen } from '@testing-library/react';
import { StageNavigator } from '@/components/patterns/stage-navigator';

const groups = [
  {
    id: 'g1',
    label: 'Phase 1',
    items: [
      { id: 'a', title: 'Write the schema', index: 1, done: true },
      { id: 'b', title: 'Wire the route', index: 2, active: true },
      { id: 'c', title: 'Add the test', index: 3 },
    ],
  },
];

/**
 * Selected and done were carried by a border colour and a check glyph that lucide renders
 * `aria-hidden` — so a screen reader heard three identical items.
 */
describe('StageNavigator conveys item state, not just colour', () => {
  it('marks the active item aria-current, and only that one', () => {
    render(<StageNavigator title="Tasks" groups={groups} showChecks />);
    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Wire the route');
  });

  it('says "done" in text for a completed item', () => {
    render(<StageNavigator title="Tasks" groups={groups} showChecks />);
    expect(screen.getByRole('button', { name: /Write the schema, done/ })).toBeInTheDocument();
    // …and does not claim it for the others.
    expect(screen.getByRole('button', { name: /^2 Wire the route$/ })).toBeInTheDocument();
  });

  it('renders an empty-state instead of silent nothing when every group is empty', () => {
    render(<StageNavigator title="Tasks" groups={[{ id: 'g', items: [] }]} />);
    expect(screen.getByText('No items yet.')).toBeInTheDocument();
  });

  it('shows the progress count when given one', () => {
    render(<StageNavigator title="Tasks" groups={groups} progress={{ value: 1, total: 3 }} />);
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });
});
