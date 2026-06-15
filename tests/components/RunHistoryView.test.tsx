import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RunHistoryView } from '../../app/(app)/loops/RunHistoryView';
import type { LoopRunRow } from '@/db/schema/loop';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/loops/activity',
  useSearchParams: () => new URLSearchParams(''),
}));

const mk = (over: Record<string, unknown>) => ({
  id: 'run1', loopId: 'l1', runId: 'abcdef1234567890', repoId: 'r1', trigger: 'manual', status: 'changed',
  branch: 'b', prUrl: null, mmaBatchId: null, keyChanges: ['Did the work.'],
  verification: { command: 'npm test', passed: true, detail: 'ok' }, filesChanged: ['a.ts'], journalEntries: null,
  startedAt: '2026-06-15T01:00:00.000Z', finishedAt: '2026-06-15T01:05:00.000Z', ...over,
}) as unknown as LoopRunRow;

const runs = [mk({}), mk({ id: 'run2', runId: 'beef000011112222', status: 'failed' })];

describe('RunHistoryView', () => {
  beforeEach(() => push.mockClear());

  it('shows the selected run detail in the canvas and lists all runs in the rail', () => {
    render(<RunHistoryView runs={runs} loops={[{ id: 'l1', name: 'Hygiene' }]} loopNames={{ l1: 'Hygiene' }} repoNames={{ r1: 'forge' }} selectedId="run1" />);
    expect(screen.getByText('Verification')).toBeInTheDocument();
    expect(screen.getByText('Did the work.')).toBeInTheDocument();
    expect(screen.getByTestId('run-list')).toBeInTheDocument();
    expect(screen.getByText('Runs (2)')).toBeInTheDocument();
  });

  it('selecting a run pushes ?run= to the URL', () => {
    render(<RunHistoryView runs={runs} loops={[{ id: 'l1', name: 'Hygiene' }]} loopNames={{ l1: 'Hygiene' }} repoNames={{}} selectedId="run1" />);
    fireEvent.click(screen.getByText('Failed').closest('button')!);
    expect(push).toHaveBeenCalledWith(expect.stringContaining('run=run2'));
  });

  it('shows an empty state when there are no runs', () => {
    render(<RunHistoryView runs={[]} loops={[]} loopNames={{}} repoNames={{}} selectedId={null} />);
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
  });
});
