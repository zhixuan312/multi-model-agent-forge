import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WriteLogView } from '@/components/forge/journal/WriteLogView';
import type { LogEntry } from '@/journal/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const LOG: LogEntry[] = [
  { date: '2026-05-24T00:00:00+08:00', op: 'create', id: '0001', title: 'First create' },
  { date: '2026-05-24T00:00:00+08:00', op: 'supersede', id: '0001', title: 'Then supersede (same day)' },
  { date: '2026-05-25T00:00:00+08:00', op: 'refine', id: '0002', title: 'A refine' },
  { date: '2026-05-26T00:00:00+08:00', op: 'archive', id: '0003', title: 'Unknown op row' },
];

describe('WriteLogView', () => {
  it('renders newest-first by reverse file (append) order, disambiguating same-day (F6)', () => {
    render(<WriteLogView log={LOG} onNavigate={() => {}} />);
    const rows = screen.getAllByTestId(/^log-row-/);
    // Reverse of append order: archive(0003), refine(0002), supersede(0001), create(0001)
    const titles = rows.map((r) => r.getAttribute('data-title'));
    expect(titles).toEqual([
      'Unknown op row',
      'A refine',
      'Then supersede (same day)',
      'First create',
    ]);
  });

  it('renders a four-column table (Date / Op / Node / Title)', () => {
    render(<WriteLogView log={LOG} onNavigate={() => {}} />);
    for (const h of ['Date', 'Op', 'Node', 'Title']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
  });

  it('an unknown op renders a neutral badge, never crashes (F18)', () => {
    render(<WriteLogView log={LOG} onNavigate={() => {}} />);
    expect(screen.getByText('archive')).toBeInTheDocument();
  });

  it('empty log → empty state', () => {
    render(<WriteLogView log={[]} onNavigate={() => {}} />);
    expect(screen.getByText(/no team learnings yet/i)).toBeInTheDocument();
  });
});
