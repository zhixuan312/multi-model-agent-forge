import { vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NodesView } from '@/components/forge/journal/NodesView';
import type { NodeSummary } from '@/journal/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const NODES: NodeSummary[] = [
  { id: '0001', title: 'Serialize same-repo write dispatch', status: 'superseded', tags: ['concurrency', 'git'], date: '2026-05-24', filename: 'nodes/0001-x.md' },
  { id: '0002', title: 'Prefer parallel dispatch', status: 'adopted', tags: ['concurrency', 'dispatch'], date: '2026-05-24', filename: 'nodes/0002-x.md' },
  { id: '0003', title: 'Investigate flaky poll timeouts', status: 'inconclusive', tags: ['polling'], date: '2026-05-25', filename: 'nodes/0003-x.md' },
  { id: '0004', title: 'Abandon force-directed graph', status: 'dropped', tags: ['ui'], date: '2026-05-26', filename: 'nodes/0004-x.md' },
];

describe('NodesView index (search / filter / sort)', () => {
  it('renders all rows with a status badge', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByTestId('node-row-0001')).toBeInTheDocument();
    expect(within(screen.getByTestId('node-row-0002')).getByText('adopted')).toBeInTheDocument();
  });

  it('search is case-insensitive substring against title AND each tag (F2)', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    // "Dispatch" matches a title (0001 "...dispatch") and a tag (0002 tag "dispatch")
    fireEvent.change(screen.getByLabelText('Search nodes'), { target: { value: 'Dispatch' } });
    expect(screen.getByTestId('node-row-0001')).toBeInTheDocument();
    expect(screen.getByTestId('node-row-0002')).toBeInTheDocument();
    expect(screen.queryByTestId('node-row-0003')).toBeNull();
    expect(screen.queryByTestId('node-row-0004')).toBeNull();
  });

  it('status filter narrows to one status', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'superseded' }));
    expect(screen.getByTestId('node-row-0001')).toBeInTheDocument();
    expect(screen.queryByTestId('node-row-0002')).toBeNull();
  });

  it('the full status filter set is present (All + four statuses)', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    for (const name of ['All', 'adopted', 'dropped', 'inconclusive', 'superseded']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('default order is id-ascending; toggle reverses to descending (F14)', () => {
    render(<NodesView nodes={NODES} skippedCount={0} selectedId={null} onSelect={() => {}} />);
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
      { id: '0005', title: 'Weird', status: 'frobnicated', tags: [], date: '2026-05-27', filename: 'nodes/0005-x.md' },
    ];
    render(<NodesView nodes={withUnknown} skippedCount={0} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByTestId('node-row-0005')).toBeInTheDocument();
    expect(within(screen.getByTestId('node-row-0005')).getByText('frobnicated')).toBeInTheDocument();
  });
});
