import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SpecStageClient } from '@/components/forge/SpecStageClient';
import type { ComponentView } from '@/spec/spec-core';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const twoSections: ComponentView[] = [
  {
    id: 'c1',
    kind: 'context',
    label: 'Context',
    primaryRoles: ['PM'],
    status: 'gathering',
    orderIndex: 0,
    sections: [
      { id: 's1', key: 'background', label: 'Background', status: 'gathering', aiSatisfied: false, humanSatisfied: false, forced: false, draftMd: null, stale: false, orderIndex: 0 },
      { id: 's2', key: 'current_state', label: 'Current state', status: 'gathering', aiSatisfied: false, humanSatisfied: false, forced: false, draftMd: null, stale: false, orderIndex: 1 },
    ],
  },
];

describe('SpecStageClient', () => {
  it('shows the Team-Settings entry guard when the main tier is not configured (F27)', () => {
    wrap(
      <SpecStageClient
        projectId="p1"
        projectName="Proj"
        intentMd="Intent"
        phase="design"
        mainTierReady={false}
        mmaReady={false}
        defaultKinds={['context']}
        initialComponents={twoSections}
        initialSpec={null}
        initialAuditHistory={[]}
        initialCanFreeze={false}
      />,
    );
    expect(screen.getByText(/Configure the main tier in Team Settings/)).toBeInTheDocument();
  });

  it('on force-advance, focus moves to the next section\'s answer input (F9)', async () => {
    const repaint = {
      section: { status: 'approved', aiSatisfied: false, humanSatisfied: true, forced: true, draftMd: 'body', stale: false },
      qaMessages: [],
      component: { status: 'gathering' },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => repaint,
    });
    vi.stubGlobal('fetch', fetchMock);

    wrap(
      <SpecStageClient
        projectId="p1"
        projectName="Proj"
        intentMd="Intent"
        phase="design"
        mainTierReady={true}
        mmaReady={true}
        defaultKinds={['context']}
        initialComponents={twoSections}
        initialSpec={null}
        initialAuditHistory={[]}
        initialCanFreeze={false}
      />,
    );

    // Force-advance the first (active) section.
    fireEvent.click(screen.getByRole('button', { name: 'Force advance' }));

    await waitFor(() => {
      // Focus management (F9): the answer textarea is focused after advance.
      expect(document.activeElement?.tagName).toBe('TEXTAREA');
    });
    vi.unstubAllGlobals();
  });
});
