// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// Admin-gated proxy for the engine's POST /configure-provider (Models tab). The
// gate short-circuits before any work; the proxy relays to a mocked MmaClient —
// no database, no real engine (the gumi convention).
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

let buildThrows = false;
const configureProvider = vi.fn(async () => ({
  verified: true,
  reason: 'ok',
  applied: true,
  tier: 'main',
  provider: 'claude',
  model: { id: 'claude-opus-4-8', family: 'claude', tier: 'main', recognized: true },
}));
vi.mock('@/mma/server-client', () => ({
  buildMmaClient: async () => {
    if (buildThrows) throw new Error('down');
    return { configureProvider };
  },
}));

const { POST } = await import('../../app/api/configure-provider/route');

function asAdmin(): AuthedMember {
  return { id: 'a', username: 'admin', displayName: 'Admin', avatarTint: '#9a6b4f', isAdmin: true };
}
function asMember(): AuthedMember {
  return { id: 'm', username: 'mem', displayName: 'Member', avatarTint: '#9a6b4f', isAdmin: false };
}
function req(body: unknown): Request {
  return new Request('http://localhost/api/configure-provider', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const VALID = { tier: 'main', provider: 'claude', model: 'claude-opus-4-8', auth: { mode: 'oauth' }, dryRun: true };

describe('POST /api/configure-provider', () => {
  beforeEach(() => {
    mockCaller = null;
    buildThrows = false;
    configureProvider.mockClear();
  });

  it('non-admin → 403, unauthenticated → 401 (before any engine call)', async () => {
    mockCaller = asMember();
    expect((await POST(req(VALID) as never)).status).toBe(403);
    mockCaller = null;
    expect((await POST(req(VALID) as never)).status).toBe(401);
    expect(configureProvider).not.toHaveBeenCalled();
  });

  it('admin + malformed body → 400 invalid_request', async () => {
    mockCaller = asAdmin();
    const res = await POST(req({ tier: 'main', provider: 'claude' }) as never); // missing model + auth
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
    expect(configureProvider).not.toHaveBeenCalled();
  });

  it('admin + engine unreachable → 502 mma_unavailable', async () => {
    mockCaller = asAdmin();
    buildThrows = true;
    const res = await POST(req(VALID) as never);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('mma_unavailable');
  });

  it('admin + valid → relays the engine result verbatim', async () => {
    mockCaller = asAdmin();
    const res = await POST(req(VALID) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verified: true, applied: true, tier: 'main' });
    expect(configureProvider).toHaveBeenCalledWith(expect.objectContaining({ tier: 'main', provider: 'claude', dryRun: true }));
  });

  it('admin + engine error → 502 configure_failed', async () => {
    mockCaller = asAdmin();
    configureProvider.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(req(VALID) as never);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('configure_failed');
  });
});
