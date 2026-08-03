import { vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NodesView } from '@/components/forge/journal/NodesView';
import type { NodeSummary } from '@/journal/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const NODES: NodeSummary[] = [
  { id: '0001', title: 'Serialize same-repo write dispatch', status: 'superseded', tags: ['concurrency', 'git'], timestamp: '2026-05-24', filename: 'nodes/0001-x.md', type: 'decision' },
  { id: '0002', title: 'Prefer parallel dispatch', status: 'adopted', tags: ['concurrency', 'dispatch'], timestamp: '2026-05-24', filename: 'nodes/0002-x.md', type: 'design' },
  { id: '0003', title: 'Investigate flaky poll timeouts', status: 'inconclusive', tags: ['polling'], timestamp: '2026-05-25', filename: 'nodes/0003-x.md', type: 'behavior' },
  { id: '0004', title: 'Abandon force-directed graph', status: 'dropped', tags: ['ui'], timestamp: '2026-05-26', filename: 'nodes/0004-x.md', type: 'design' },
];

/** The two filter rows are single-select, so each is a radiogroup — scope by name. */
const statusGroup = () => within(screen.getByRole('radiogroup', { name: 'Filter by status' }));
const categoryGroup = () => within(screen.getByRole('radiogroup', { name: 'Filter by category' }));
const expandStatus = () => fireEvent.click(screen.getByRole('button', { name: /^Status:/ }));

function showAllStatuses() {
  expandStatus();
  fireEvent.click(statusGroup().getByRole('radio', { name: 'All' }));
}

describe('NodesView index (search / filter / sort)', () => {
  it('renders all rows with a status badge when status filter is All', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    showAllStatuses();
    expect(screen.getByTestId('node-row-0001')).toBeInTheDocument();
    expect(within(screen.getByTestId('node-row-0002')).getByText('adopted')).toBeInTheDocument();
  });

  it('search is case-insensitive substring against title AND each tag (F2)', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    showAllStatuses();
    // "Dispatch" matches a title (0001 "...dispatch") and a tag (0002 tag "dispatch")
    fireEvent.change(screen.getByLabelText('Search title or tags'), { target: { value: 'Dispatch' } });
    expect(screen.getByTestId('node-row-0001')).toBeInTheDocument();
    expect(screen.getByTestId('node-row-0002')).toBeInTheDocument();
    expect(screen.queryByTestId('node-row-0003')).toBeNull();
    expect(screen.queryByTestId('node-row-0004')).toBeNull();
  });

  it('status filter narrows to one status', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    expandStatus();
    fireEvent.click(statusGroup().getByRole('radio', { name: 'superseded' }));
    expect(screen.getByTestId('node-row-0001')).toBeInTheDocument();
    expect(screen.queryByTestId('node-row-0002')).toBeNull();
  });

  it('the full status filter set is present (All + four statuses)', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    expandStatus();
    for (const name of ['All', 'adopted', 'dropped', 'inconclusive', 'superseded']) {
      expect(statusGroup().getByRole('radio', { name })).toBeInTheDocument();
    }
    expect(statusGroup().getAllByRole('radio')).toHaveLength(5);
  });

  it('default order is id-ascending; toggle reverses to descending (F14)', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    showAllStatuses();
    const idsAsc = screen.getAllByTestId(/^node-row-/).map((el) => el.getAttribute('data-testid'));
    expect(idsAsc[0]).toBe('node-row-0001');
    fireEvent.click(screen.getByRole('button', { name: /sort/i }));
    const idsDesc = screen.getAllByTestId(/^node-row-/).map((el) => el.getAttribute('data-testid'));
    expect(idsDesc[0]).toBe('node-row-0004');
  });

  it('shows the "N node(s) could not be parsed" notice when skippedCount > 0 (F13)', () => {
    render(<NodesView nodes={NODES} skippedCount={2} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/2 node\(s\) could not be parsed/i)).toBeInTheDocument();
  });

  it('a node with an unknown status still appears with a neutral chip (F19)', () => {
    const withUnknown = [
      ...NODES,
      { id: '0005', title: 'Weird', status: 'frobnicated', tags: [], timestamp: '2026-05-27', filename: 'nodes/0005-x.md', type: 'knowledge' },
    ];
    render(<NodesView nodes={withUnknown} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    showAllStatuses();
    expect(screen.getByTestId('node-row-0005')).toBeInTheDocument();
    expect(within(screen.getByTestId('node-row-0005')).getByText('frobnicated')).toBeInTheDocument();
  });

  /**
   * Both filter rows replace the selection rather than toggling independently, so each
   * is a radiogroup. They were rows of `aria-pressed` buttons — a screen reader heard N
   * independent on/off controls and never "1 of N". Same defect the Spec template picker
   * had.
   */
  describe('filters are single-select', () => {
    it('exposes category and status as named radiogroups, not toggle buttons', () => {
      render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
      expandStatus();
      expect(categoryGroup().getAllByRole('radio').length).toBeGreaterThan(1);
      expect(statusGroup().getAllByRole('radio').length).toBeGreaterThan(1);
      expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    });

    it('marks exactly one option checked per group, and moves it on select', () => {
      render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
      expandStatus();
      const checked = (g: ReturnType<typeof statusGroup>) =>
        g.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');

      expect(checked(statusGroup())).toHaveLength(1);
      expect(checked(statusGroup())[0]).toHaveAccessibleName('adopted'); // the default
      expect(checked(categoryGroup())).toHaveLength(1);

      fireEvent.click(statusGroup().getByRole('radio', { name: 'dropped' }));
      expect(checked(statusGroup())).toHaveLength(1);
      expect(checked(statusGroup())[0]).toHaveAccessibleName('dropped');
    });
  });
});
