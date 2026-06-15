import { render, screen } from '@testing-library/react';
import { RunDetail } from '../../app/(app)/loops/RunDetail';
import type { LoopRunRow } from '@/db/schema/loop';

const base = {
  id: 'run1', loopId: 'l1', runId: 'abcdef1234567890', repoId: 'r1', trigger: 'manual', status: 'changed',
  branch: 'loop/hygiene/2026-06-15-abcdef', prUrl: 'https://github.com/x/y/pull/1', mmaBatchId: null,
  startedAt: '2026-06-15T01:00:00.000Z', finishedAt: '2026-06-15T01:05:00.000Z',
};

function make(over: Record<string, unknown>): LoopRunRow {
  return { ...base, keyChanges: null, verification: null, filesChanged: null, journalEntries: null, ...over } as unknown as LoopRunRow;
}

describe('RunDetail', () => {
  it('unwraps a JSON-blob change into a prose Summary, never raw JSON', () => {
    const blob = JSON.stringify({ findings: [{ severity: 'low', description: 'x' }], summary: 'Fixed the claims expectation.', verdict: 'changes_made' });
    render(<RunDetail run={make({ keyChanges: [blob, 'correctness: tightened a test'] })} repoName="forge" />);
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Fixed the claims expectation.')).toBeInTheDocument();
    expect(screen.getByText('correctness: tightened a test')).toBeInTheDocument();
    expect(screen.queryByText(/"findings"/)).not.toBeInTheDocument();
  });

  it('renders verification states from the structured slot', () => {
    const { rerender } = render(<RunDetail run={make({ verification: { command: 'npm test', passed: true, detail: 'all green' } })} />);
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();

    rerender(<RunDetail run={make({ verification: { command: null, passed: null, detail: '' } })} />);
    expect(screen.getByText(/Not configured/)).toBeInTheDocument();
  });

  it('lists files changed and journal entries', () => {
    render(<RunDetail run={make({ filesChanged: ['a.ts', 'b.ts'], journalEntries: [{ tag: 'learned', text: 'kept tests green' }] })} />);
    expect(screen.getByText('Files changed')).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('learned')).toBeInTheDocument();
    expect(screen.getByText('kept tests green')).toBeInTheDocument();
  });

  it('drops legacy metadata change lines (file count / verification) from the changes list', () => {
    render(<RunDetail run={make({ keyChanges: ['Did the work.', '7 file(s) changed', 'verification: not configured'] })} />);
    expect(screen.getByText('Did the work.')).toBeInTheDocument();
    expect(screen.queryByText('7 file(s) changed')).not.toBeInTheDocument();
    expect(screen.queryByText('verification: not configured')).not.toBeInTheDocument();
  });

  it('shows an in-progress note for a running run', () => {
    render(<RunDetail run={make({ status: 'running', finishedAt: null })} />);
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
  });
});
