import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditPanel } from '@/components/forge/SpecStageClient';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('AuditPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the pass timeline ("pass 1: 2 findings → revised · pass 2: clean")', () => {
    wrap(
      <AuditPanel
        projectId="p1"
        readOnly={false}
        mmaReady={true}
        initialHistory={[
          { passNo: 1, findingsCount: 2, verdict: 'revised' },
          { passNo: 2, findingsCount: 0, verdict: 'clean' },
        ]}
        initialCanFreeze={true}
        onError={() => {}}
      />,
    );
    const timeline = screen.getByTestId('audit-timeline');
    expect(timeline).toHaveTextContent('pass 1: 2 findings → revised');
    expect(timeline).toHaveTextContent('pass 2: clean');
  });

  it('the Freeze link is disabled when canFreeze is false', () => {
    wrap(
      <AuditPanel
        projectId="p1"
        readOnly={false}
        mmaReady={true}
        initialHistory={[{ passNo: 1, findingsCount: 1, verdict: 'revised' }]}
        initialCanFreeze={false}
        onError={() => {}}
      />,
    );
    expect(screen.getByTestId('freeze-link')).toHaveAttribute('aria-disabled', 'true');
  });

  it('the Freeze link is enabled and links to /freeze when canFreeze is true', () => {
    wrap(
      <AuditPanel
        projectId="p1"
        readOnly={false}
        mmaReady={true}
        initialHistory={[{ passNo: 1, findingsCount: 0, verdict: 'clean' }]}
        initialCanFreeze={true}
        onError={() => {}}
      />,
    );
    expect(screen.getByTestId('freeze-link')).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByTestId('freeze-link')).toHaveAttribute('href', '/projects/p1/freeze');
  });

  it('Run audit posts and appends the new pass + unlocks freeze on clean', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pass: { passNo: 1, verdict: 'clean', findingsCount: 0, findings: [] },
        contextBlockId: 'cb-1',
        history: [{ passNo: 1, findingsCount: 0, verdict: 'clean' }],
        canFreeze: true,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    wrap(
      <AuditPanel
        projectId="p1"
        readOnly={false}
        mmaReady={true}
        initialHistory={[]}
        initialCanFreeze={false}
        onError={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
    await waitFor(() => {
      expect(screen.getByTestId('audit-timeline')).toHaveTextContent('pass 1: clean');
      expect(screen.getByTestId('freeze-link')).toHaveAttribute('aria-disabled', 'false');
    });
    // cwd-less spec audit POST went to the audit route.
    expect(fetchMock).toHaveBeenCalledWith('/projects/p1/spec/audit', expect.objectContaining({ method: 'POST' }));
  });

  it('Run audit is disabled when the MMA token is not configured (F27)', () => {
    wrap(
      <AuditPanel
        projectId="p1"
        readOnly={false}
        mmaReady={false}
        initialHistory={[]}
        initialCanFreeze={false}
        onError={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Run audit' })).toBeDisabled();
    expect(screen.getByText(/Configure the MMA token/)).toBeInTheDocument();
  });

  it('shows the override control after the cap is reached with standing findings', () => {
    wrap(
      <AuditPanel
        projectId="p1"
        readOnly={false}
        mmaReady={true}
        initialHistory={[
          { passNo: 1, findingsCount: 1, verdict: 'revised' },
          { passNo: 2, findingsCount: 1, verdict: 'revised' },
          { passNo: 3, findingsCount: 1, verdict: 'revised' },
          { passNo: 4, findingsCount: 1, verdict: 'revised' },
        ]}
        initialCanFreeze={false}
        onError={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /override/i })).toBeInTheDocument();
  });
});
