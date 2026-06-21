import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { RecallTab } from '@/components/forge/journal/RecallTab';
import type { PinnedView, FaqView } from '@/journal/recall-content';

// AC-9 (FAQ click-to-run) + AC-10 (pin/unpin/refresh + a11y). Backend + routes are
// covered by their own unit tests; here we drive the client surface and assert the
// HTTP calls it makes (the recall dispatch and the pin routes are all `fetch`).

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const INDEX = [{ id: '0001', title: 'A node', status: 'adopted' as const }];

/** A fetch fake routing the recall dispatch+poll and the pin routes. */
function installFetch(overrides: Partial<Record<string, () => Response>> = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
    const u = String(url);
    const method = opts?.method ?? 'GET';
    calls.push({ url: u, method, body: opts?.body ? JSON.parse(String(opts.body)) : undefined });
    const key = `${method} ${u.replace(/\/recall\/.*/, '/recall/:id').replace(/\/pins\/[^/]+/, '/pins/:id')}`;
    if (overrides[key]) return overrides[key]!();
    if (u === '/api/journal/recall' && method === 'POST')
      return new Response(JSON.stringify({ batchId: 'b1' }), { status: 202 });
    if (u.startsWith('/api/journal/recall/'))
      return new Response(
        JSON.stringify({
          state: 'terminal',
          envelope: { structuredReport: { summary: '```json\n' + JSON.stringify({ results: [], summary: 'Recalled answer.' }) + '\n```' } },
        }),
        { status: 200 },
      );
    if (method === 'DELETE' && /\/api\/journal\/pins\//.test(u)) return new Response(null, { status: 204 });
    if (method === 'POST' && u === '/api/journal/pins') return new Response(JSON.stringify({}), { status: 201 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const pin = (over: Partial<PinnedView> = {}): PinnedView => ({
  id: 'p1',
  question: 'How does authentication work here',
  answerMd: 'Cached answer body.',
  findings: [],
  citationIds: [],
  journalLogCount: 5,
  stale: false,
  ...over,
});

describe('RecallTab — FAQ click-to-run (AC-9)', () => {
  it('clicking a FAQ runs exactly one recall with that question and shows the answer', async () => {
    vi.useFakeTimers();
    const { calls } = installFetch();
    const faqs: FaqView[] = [{ question: 'how should new settings tabs be structured', count: 4 }];
    render(<RecallTab index={INDEX} pinned={[]} faqs={faqs} />);

    fireEvent.click(screen.getByRole('button', { name: /how should new settings tabs/i }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const dispatches = calls.filter((c) => c.url === '/api/journal/recall' && c.method === 'POST');
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.body).toMatchObject({ query: 'how should new settings tabs be structured' });
    expect(screen.getByText('Recalled answer.')).toBeInTheDocument();
  });
});

describe('RecallTab — pinned rows (AC-10)', () => {
  it('expands in place (aria-expanded), shows the stale badge + cached answer, and unpins', async () => {
    const { calls } = installFetch();
    render(<RecallTab index={INDEX} pinned={[pin({ stale: true })]} faqs={[]} />);

    const trigger = screen.getByRole('button', { name: /How does authentication work here/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/Journal updated since/i)).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Cached answer body.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Unpin this answer/i }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /How does authentication work here/i })).toBeNull(),
    );
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/journal/pins/p1')).toBe(true);
  });

  it('refresh re-runs the recall and clears the stale badge', async () => {
    vi.useFakeTimers();
    installFetch({
      'POST /api/journal/pins/:id/refresh': () =>
        new Response(JSON.stringify({ ...pin({ stale: false }), answerMd: 'Fresh answer.' }), { status: 200 }),
    });
    render(<RecallTab index={INDEX} pinned={[pin({ stale: true })]} faqs={[]} />);

    fireEvent.click(screen.getByRole('button', { name: /How does authentication work here/i }));
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.queryByText(/Journal updated since/i)).toBeNull();
  });
});

describe('RecallTab — pin from the live answer (AC-10)', () => {
  it('pins the just-recalled answer and reflects it in the pinned list', async () => {
    vi.useFakeTimers();
    const { calls } = installFetch({
      'POST /api/journal/pins': () =>
        new Response(JSON.stringify(pin({ id: 'new', question: 'q one two three', answerMd: 'Recalled answer.' })), {
          status: 201,
        }),
    });
    const faqs: FaqView[] = [{ question: 'how should new settings tabs be structured', count: 2 }];
    render(<RecallTab index={INDEX} pinned={[]} faqs={faqs} />);

    fireEvent.click(screen.getByRole('button', { name: /how should new settings tabs/i }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const pinBtn = screen.getByRole('button', { name: /Pin this answer/i });
    await act(async () => {
      fireEvent.click(pinBtn);
    });
    expect(screen.getByText('Pinned')).toBeInTheDocument();

    const posts = calls.filter((c) => c.method === 'POST' && c.url === '/api/journal/pins');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ question: 'how should new settings tabs be structured', answerMd: 'Recalled answer.' });
  });
});
