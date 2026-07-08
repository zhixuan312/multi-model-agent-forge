// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

// Mock the pins core + journal-rev + workspace root so the route test asserts the
// member gate + CSRF + verb/code contract without a DB or the journal on disk.
const pin = { id: 'p1', question: 'q', answerMd: 'a', findings: [] as unknown[], citationIds: [] as string[], journalLogCount: 7, answeredAt: new Date(), createdAt: new Date() };
const listPins = vi.fn(async () => [pin]);
const addPin = vi.fn(async () => pin);
const removePin = vi.fn(async () => ({ kind: 'removed' }) as { kind: 'removed' | 'not_found' });
const refreshPin = vi.fn(async () => ({ kind: 'refreshed', pin }) as { kind: 'refreshed'; pin: typeof pin } | { kind: 'not_found' });
vi.mock('@/journal/pins-core', () => ({ listPins, addPin, removePin, refreshPin }));
vi.mock('@/journal/journal-rev', () => ({ currentJournalLogCount: async () => 9, isPinStale: (a: number, b: number) => a < b }));
vi.mock('@/git/workspace-root', () => ({ resolveWorkspaceRoot: () => '/ws' }));

const { GET: pinsGET, POST: pinsPOST } = await import('../../app/api/journal/pins/route');
const { DELETE: pinDELETE } = await import('../../app/api/journal/pins/[id]/route');
const { POST: pinRefresh } = await import('../../app/api/journal/pins/[id]/refresh/route');

const member = (): AuthedMember => ({ id: 'm1', username: 'm', displayName: 'M', avatarTint: '#000', role: 'member', teamId: 'team-1' });
function req(body: unknown, method = 'POST', extraHeaders: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/journal/pins', {
    method,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('journal pins API', () => {
  beforeEach(() => {
    mockCaller = null;
    vi.clearAllMocks();
  });

  it('GET: member → 200 with stale flags; anon → 401', async () => {
    mockCaller = member();
    const res = await pinsGET(req(undefined, 'GET') as never);
    expect(res.status).toBe(200);
    expect(listPins).toHaveBeenCalledWith('m1');
    const body = await res.json();
    expect(body[0].stale).toBe(true); // pin count 7 < current 9
    mockCaller = null;
    expect((await pinsGET(req(undefined, 'GET') as never)).status).toBe(401);
  });

  it('POST: valid same-origin → 201; invalid body → 400; cross-origin → 403 (no add); anon → 401', async () => {
    mockCaller = member();
    const finding = { learning: 'L', context: 'C', relevance: 'high', nodeId: '0001', category: 'design', status: 'adopted' };
    expect((await pinsPOST(req({ question: 'q', answerMd: 'a', findings: [finding], citationIds: ['0001'] }) as never)).status).toBe(201);
    expect(addPin).toHaveBeenCalledOnce();
    expect(addPin).toHaveBeenCalledWith('m1', expect.objectContaining({ findings: [finding] }));
    expect((await pinsPOST(req({ question: '' }) as never)).status).toBe(400);
    const x = await pinsPOST(req({ question: 'q', answerMd: 'a' }, 'POST', { 'sec-fetch-site': 'cross-site' }) as never);
    expect(x.status).toBe(403);
    expect(addPin).toHaveBeenCalledOnce(); // not called again
    mockCaller = null;
    expect((await pinsPOST(req({ question: 'q', answerMd: 'a' }) as never)).status).toBe(401);
  });

  it('DELETE: owner → 204; not-found/non-owner → 404; cross-origin → 403', async () => {
    mockCaller = member();
    expect((await pinDELETE(req(undefined, 'DELETE') as never, ctx('p1'))).status).toBe(204);
    removePin.mockResolvedValueOnce({ kind: 'not_found' });
    expect((await pinDELETE(req(undefined, 'DELETE') as never, ctx('nope'))).status).toBe(404);
    const x = await pinDELETE(req(undefined, 'DELETE', { 'sec-fetch-site': 'cross-site' }) as never, ctx('p1'));
    expect(x.status).toBe(403);
  });

  it('refresh: valid → 200; not-found → 404; bad body → 400', async () => {
    mockCaller = member();
    expect((await pinRefresh(req({ answerMd: 'a2', citationIds: ['0002'] }) as never, ctx('p1'))).status).toBe(200);
    refreshPin.mockResolvedValueOnce({ kind: 'not_found' });
    expect((await pinRefresh(req({ answerMd: 'a2' }) as never, ctx('nope'))).status).toBe(404);
    expect((await pinRefresh(req({ answerMd: '' }) as never, ctx('p1'))).status).toBe(400);
  });
});
