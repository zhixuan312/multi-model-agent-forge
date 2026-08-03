import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GraphTab } from '@/components/forge/journal/GraphTab';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The 3D canvas needs WebGL/rAF; the rail is what this file is about.
vi.mock('@/components/forge/journal/JournalGraph3D', () => ({
  JournalGraph3D: () => <div data-testid="graph" />,
}));

const nodes = [{ id: '0001', title: 'A', status: 'adopted', type: 'decision' }] as never;

describe('GraphTab rail', () => {
  /**
   * `JournalNote` and `GraphLegend` were both passed to StageShell, which stacks the
   * note directly above the navigator — so the rail listed the four status meanings
   * twice and carried two word-for-word "Recorded by MMA" lines.
   */
  it('states each status meaning exactly once', () => {
    render(<GraphTab nodes={nodes} edges={[]} />);
    expect(screen.getAllByText(/a live learning/)).toHaveLength(1);
    expect(screen.getAllByText(/replaced by a newer node/)).toHaveLength(1);
  });

  it('states the read-only provenance exactly once', () => {
    render(<GraphTab nodes={nodes} edges={[]} />);
    expect(screen.getAllByText(/Recorded by MMA/)).toHaveLength(1);
  });

  it('keeps the framing the removed note carried', () => {
    render(<GraphTab nodes={nodes} edges={[]} />);
    expect(screen.getByText('Decision graph')).toBeInTheDocument();
    expect(screen.getByText(/one decision the team reached/)).toBeInTheDocument();
  });

  it('still keys every status and every edge type', () => {
    render(<GraphTab nodes={nodes} edges={[]} />);
    for (const s of ['adopted', 'superseded', 'inconclusive', 'dropped']) {
      expect(screen.getByText(s)).toBeInTheDocument();
    }
    for (const e of ['supersedes', 'refines', 'relates', 'depends-on', 'contradicts', 'parent']) {
      expect(screen.getByText(e)).toBeInTheDocument();
    }
  });

  it('shows an empty message rather than an empty canvas when there is nothing to graph', () => {
    render(<GraphTab nodes={[]} edges={[]} />);
    expect(screen.getByText(/No nodes to graph yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('graph')).not.toBeInTheDocument();
  });
});
