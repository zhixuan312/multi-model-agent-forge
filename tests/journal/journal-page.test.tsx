import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PinView } from '@/journal/pins-core';

// AC-8 (first-paint wiring), AC-13 (metric counts), AC-14 (first-paint staleness):
// the journal page's Recall view must load real pins + FAQs and derive each pin's
// staleness from a single `currentJournalLogCount` read. Loaders, the journal
// reader, auth, and fs are mocked so the server component renders without a DB.

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const stub = { ...actual, existsSync: () => true };
  return { ...stub, default: stub };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/git/workspace-root', () => ({ resolveWorkspaceRoot: () => '/ws' }));
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => ({ id: 'm1', username: 'm', displayName: 'M', avatarTint: '#000', role: 'member', teamId: 'team-1' }),
}));
vi.mock('@/journal/store-reader', () => ({
  readAllNodes: async () => ({
    kind: 'ok',
    nodes: [{ id: '0001', status: 'adopted', title: 'A node', source: 'spec', type: 'decision' }],
    log: [{ timestamp: '2026-01-01', op: 'create', id: '0001', title: 'A node' }],
    skippedCount: 0,
  }),
  readNodeFrontmatters: async () => [],
}));

const PINS: PinView[] = [
  { id: 'p1', question: 'How does authentication work here', answerMd: 'A.', findings: [], citationIds: [], journalLogCount: 4, answeredAt: new Date(), createdAt: new Date() },
  { id: 'p2', question: 'Where do settings live', answerMd: 'B.', findings: [], citationIds: [], journalLogCount: 9, answeredAt: new Date(), createdAt: new Date() },
];
const listPins = vi.fn(async () => PINS);
const topFaqs = vi.fn(async () => [
  { question: 'how to add a provider', count: 7 },
  { question: 'how to seed the journal', count: 3 },
  { question: 'where is the config', count: 1 },
]);
vi.mock('@/journal/pins-core', () => ({ listPins }));
vi.mock('@/journal/faqs-core', () => ({ topFaqs }));
vi.mock('@/db/client', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }) }),
  }),
}));

const currentJournalLogCount = vi.fn(async () => 9);
vi.mock('@/journal/journal-rev', () => ({
  currentJournalLogCount,
  isPinStale: (a: number, b: number) => a < b,
}));

const { default: JournalPage } = await import('../../app/(app)/journal/page');

async function renderRecall() {
  const ui = await JournalPage({ searchParams: Promise.resolve({ view: 'recall' }) });
  return render(ui as React.ReactElement);
}

describe('journal page — Recall first paint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('AC-8: RecallTab receives the real pins + FAQs from the loaders', async () => {
    await renderRecall();
    expect(listPins).toHaveBeenCalledWith('m1');
    expect(topFaqs).toHaveBeenCalled();
    expect(screen.getByText('How does authentication work here')).toBeInTheDocument();
    expect(screen.getByText('how to add a provider')).toBeInTheDocument();
  });

  it('AC-13: the metric row shows the pin count and FAQ count', async () => {
    await renderRecall();
    // disambiguate the metric card (unique sublabel) from the section heading.
    const pinnedCard = screen.getByText('Saved answers').parentElement as HTMLElement;
    expect(within(pinnedCard).getByText('2')).toBeInTheDocument();
    const faqCard = screen.getByText('Common questions').parentElement as HTMLElement;
    expect(within(faqCard).getByText('3')).toBeInTheDocument();
  });

  it('AC-14: staleness is derived from a single currentJournalLogCount read', async () => {
    await renderRecall();
    // log count 9: pin p1 (marker 4) is stale; p2 (marker 9) is fresh → exactly one badge.
    expect(screen.getAllByText(/Journal updated since/i)).toHaveLength(1);
    expect(currentJournalLogCount).toHaveBeenCalledTimes(1);
  });
});
