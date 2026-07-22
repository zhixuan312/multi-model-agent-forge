import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/journal',
  useSearchParams: () => new URLSearchParams(),
}));
globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as never;

import { NodesTab } from '@/components/forge/journal/NodesTab';
import type { NodeSummary } from '@/journal/types';

const nodes: NodeSummary[] = [
  { id: 'n1', title: 'Prefer a JSON store', status: 'adopted', tags: [], timestamp: '2026-01-01', filename: 'nodes/n1.md', source: 'MMA', type: 'decision' },
];

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TooltipProvider>{ui}</TooltipProvider></QueryClientProvider>);
}

describe('NodesTab (QA F9 — no fake record)', () => {
  it('renders the server-read nodes and no longer offers the fake "Record a learning"', () => {
    wrap(<NodesTab nodes={nodes} skippedCount={0} />);
    expect(screen.getByText('Prefer a JSON store')).toBeInTheDocument();
    expect(screen.queryByText('Record a learning')).toBeNull();
  });

  it('defaults selection to the first ADOPTED node, not a superseded nodes[0] hidden by the filter (QA F14)', () => {
    // First node is superseded (hidden by the adopted-only default filter); the default
    // detail must be the adopted node, which is visible in the list.
    const mixed: NodeSummary[] = [
      { id: 'old', title: 'Superseded call', status: 'superseded', tags: [], timestamp: '2026-01-01', filename: 'nodes/old.md', source: 'MMA', type: 'decision' },
      { id: 'live', title: 'Adopted call', status: 'adopted', tags: [], timestamp: '2026-01-02', filename: 'nodes/live.md', source: 'MMA', type: 'decision' },
    ];
    wrap(<NodesTab nodes={mixed} skippedCount={0} />);
    // LazyNodeDetail fetches the selected id — the request must target the adopted node.
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/live'))).toBe(true);
    expect(urls.some((u) => u.includes('/old'))).toBe(false);
  });
});
