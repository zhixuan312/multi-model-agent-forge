import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoopUsageTable } from '../../app/(app)/usage/LoopUsageTable';
import { StandaloneUsageTable } from '../../app/(app)/usage/StandaloneUsageTable';
import { LoopsClient } from '../../app/(app)/loops/LoopsClient';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/ui/toast', () => ({ showToast: vi.fn(), Toaster: () => null }));

/**
 * These tables render a FILTERED list, so their empty state fires for two different
 * situations: nothing exists, and nothing matches. Each described only the first —
 * "No loops have run in this period", "Create a loop to run a goal…" — which is wrong
 * advice when the user has simply typed a search that matches nothing.
 */
describe('empty states distinguish "nothing there" from "nothing matches"', () => {
  it('LoopUsageTable: an empty period reads as an empty period', () => {
    render(<LoopUsageTable data={[]} detailByLoop={{}} />);
    expect(screen.getByText('No loop activity')).toBeInTheDocument();
  });

  it('LoopUsageTable: a filter that excludes everything says so', () => {
    const rows = [{ loopId: 'l1', loopName: 'Nightly', runs: 2, costUsd: 1, tokens: 10, durationMs: 5 }] as never;
    render(<LoopUsageTable data={rows} detailByLoop={{}} />);
    fireEvent.change(screen.getByLabelText('Search loops'), { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('No loops match')).toBeInTheDocument();
    expect(screen.queryByText('No loop activity')).not.toBeInTheDocument();
  });

  it('StandaloneUsageTable: same split', () => {
    render(<StandaloneUsageTable data={[]} />);
    expect(screen.getByText('No standalone activity')).toBeInTheDocument();
  });

  it('LoopsClient: an empty workspace invites you to create one', () => {
    render(<LoopsClient initialLoops={[]} repoOptions={[]} />);
    expect(screen.getByText('No loops yet')).toBeInTheDocument();
  });

  it('LoopsClient: a filter that excludes everything does NOT invite you to create one', () => {
    const loops = [{ id: 'l1', name: 'Nightly', mode: 'manual', cron: null, enabled: true, repoIds: [], workerTier: 'standard' }] as never;
    render(<LoopsClient initialLoops={loops} repoOptions={[]} />);
    fireEvent.change(screen.getByLabelText('Search loops'), { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('No loops match')).toBeInTheDocument();
    expect(screen.queryByText('No loops yet')).not.toBeInTheDocument();
  });
});

/**
 * The row-expand toggles were permanently labelled "Expand" with no `aria-expanded` —
 * a screen reader heard the same thing whether the row was open or shut, and `isOpen`,
 * computed directly above each one, only ever rotated the chevron.
 */
describe('row expand toggles carry their state', () => {
  const rows = [{ loopId: 'l1', loopName: 'Nightly', runs: 2, costUsd: 1, tokens: 10, durationMs: 5 }] as never;

  it('names what expands and reports whether it is open', async () => {
    render(<LoopUsageTable data={rows} detailByLoop={{}} />);
    const toggle = screen.getByRole('button', { name: 'Route breakdown for Nightly' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Route breakdown for Nightly' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('no longer offers an unlabelled "Expand"', () => {
    render(<LoopUsageTable data={rows} detailByLoop={{}} />);
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument();
  });
});
