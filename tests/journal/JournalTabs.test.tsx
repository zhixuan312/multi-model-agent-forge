import { vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { JournalTabs } from '@/components/forge/journal/JournalTabs';
import type { NodeSummary, LogEntry } from '@/journal/types';

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
  usePathname: () => '/journal',
}));

const NODES: NodeSummary[] = [
  { id: '0001', title: 'Alpha', status: 'adopted', tags: ['x'], date: '2026-05-24', filename: 'nodes/0001-a.md' },
  { id: '0002', title: 'Beta', status: 'superseded', tags: ['y'], date: '2026-05-24', filename: 'nodes/0002-b.md' },
  { id: '0003', title: 'Gamma', status: 'frobnicated', tags: ['z'], date: '2026-05-25', filename: 'nodes/0003-c.md' },
];
const LOG: LogEntry[] = [
  { date: '2026-05-24T00:00:00+08:00', op: 'create', id: '0001', title: 'Alpha' },
];

function renderTabs(view?: string, node?: string) {
  const sp = new URLSearchParams();
  if (view) sp.set('view', view);
  if (node) sp.set('node', node);
  searchParams = sp;
  return render(
    <JournalTabs read={{ kind: 'ok', nodes: NODES, log: LOG, skippedCount: 1 }} initialView={view} initialNode={node} />,
  );
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
});

describe('JournalTabs (a11y + routing + pills)', () => {
  it('exposes a tablist with three tabs and tabpanels (a11y F9)', () => {
    renderTabs('nodes');
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('arrow keys move between tabs; Enter/Space activates (a11y F9)', () => {
    renderTabs('nodes');
    const tabs = screen.getAllByRole('tab');
    tabs[1]!.focus();
    fireEvent.keyDown(tabs[1]!, { key: 'ArrowRight' });
    // focus moved to next tab (log)
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2]!, { key: 'Enter' });
    expect(push).toHaveBeenCalled();
  });

  it('absent/unrecognized ?view defaults to nodes (F23/F11)', () => {
    renderTabs(); // no view
    expect(screen.getByRole('tab', { name: /nodes/i })).toHaveAttribute('aria-selected', 'true');
    cleanup();
    renderTabs('garbage');
    expect(screen.getByRole('tab', { name: /nodes/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('?view=recall selects the Recall tab; ?view=log selects Write-log', () => {
    renderTabs('recall');
    expect(screen.getByRole('tab', { name: /recall/i })).toHaveAttribute('aria-selected', 'true');
    cleanup();
    renderTabs('log');
    expect(screen.getByRole('tab', { name: /write.?log/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('header node-count pill counts parsed nodes only; per-status pills bucket only known statuses (F3/F10)', () => {
    renderTabs('nodes');
    // 3 parsed nodes (skippedCount excluded from count)
    expect(screen.getByTestId('pill-node-count')).toHaveTextContent('3');
    // per-status: adopted=1, superseded=1; the frobnicated node is in NO status pill
    expect(screen.getByTestId('pill-status-adopted')).toHaveTextContent('1');
    expect(screen.getByTestId('pill-status-superseded')).toHaveTextContent('1');
    expect(screen.queryByTestId('pill-status-frobnicated')).toBeNull();
  });

  it('exposes NO write/edit affordance (read-only invariant F10)', () => {
    renderTabs('nodes');
    expect(screen.queryByText(/new node/i)).toBeNull();
    expect(screen.queryByText(/edit node/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /create node/i })).toBeNull();
  });
});

describe('JournalTabs empty / config states', () => {
  it('empty journal → empty state', () => {
    searchParams = new URLSearchParams();
    render(<JournalTabs read={{ kind: 'empty' }} />);
    expect(screen.getByText(/no team learnings yet/i)).toBeInTheDocument();
  });
  it('unconfigured workspace root → config-needed state (links to Team Settings)', () => {
    searchParams = new URLSearchParams();
    render(<JournalTabs read={{ kind: 'unconfigured' }} />);
    expect(screen.getByText(/team settings/i)).toBeInTheDocument();
  });
  it('unreadable journal dir → diagnostic state', () => {
    searchParams = new URLSearchParams();
    render(<JournalTabs read={{ kind: 'unreadable' }} />);
    expect(screen.getByText(/unreadable/i)).toBeInTheDocument();
  });
});
