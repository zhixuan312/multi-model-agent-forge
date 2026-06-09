import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FreezeClient, type LearningCandidateView } from '@/components/forge/FreezeClient';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const candidates: LearningCandidateView[] = [
  { id: 'l1', bodyMd: 'The dual gate was the riskiest part.', type: 'challenge', status: 'proposed', recordedNodeId: null },
  { id: 'l2', bodyMd: 'We chose workspace-root cwd.', type: 'decision', status: 'kept', recordedNodeId: null },
];

describe('FreezeClient (learnings curation)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('warns that freeze is irreversible and renders the candidate cards', () => {
    wrap(<FreezeClient projectId="p1" frozen={true} initialCandidates={candidates} />);
    expect(screen.getByTestId('freeze-banner')).toHaveAttribute('data-frozen', 'true');
    expect(screen.getByText(/point of no return/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('learning-card')).toHaveLength(2);
  });

  it('keep/remove toggles patch the candidate (curation)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ ...candidates[0], status: 'removed' }, candidates[1]],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    wrap(<FreezeClient projectId="p1" frozen={true} initialCandidates={candidates} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/projects/p1/spec/learnings/l1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  it('"Record to journal" commits the kept learnings', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        recordedCount: 1,
        candidates: [candidates[0], { ...candidates[1], status: 'recorded', recordedNodeId: '0007-x' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    wrap(<FreezeClient projectId="p1" frozen={true} initialCandidates={candidates} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record to journal' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/projects/p1/spec/learnings/commit',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(screen.getByText(/recorded · 0007-x/)).toBeInTheDocument();
    });
  });

  it('proposes candidates on first load when none exist (idempotent)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates }),
    });
    vi.stubGlobal('fetch', fetchMock);

    wrap(<FreezeClient projectId="p1" frozen={true} initialCandidates={[]} />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/projects/p1/spec/learnings',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
