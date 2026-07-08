// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// Admin-gated "Validate connection" probe (Connections tab). Gate short-circuits
// before any work; mma uses a mocked client, git/openai use mocked probes with a
// typed token (so no DB is read) — the gumi convention, no database.
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

const health = vi.fn(async () => ({ status: 'ok' as const }));
const status = vi.fn(async () => ({ authValid: true }));
vi.mock('@/mma/server-client', () => ({ buildMmaClient: async () => ({ health, status }) }));

const probeGit = vi.fn(async () => ({ ok: true, detail: 'Git reachable.' }));
const probeOpenai = vi.fn(async () => ({ ok: true, detail: 'OpenAI key valid.' }));
vi.mock('@/config/connections-probe', () => ({ probeGit, probeOpenai }));

const { POST } = await import('../../app/api/connections/validate/route');

function asAdmin(): AuthedMember {
  return { id: 'a', username: 'admin', displayName: 'Admin', avatarTint: '#9a6b4f', role: 'team_admin', teamId: 'team-1' };
}
function req(body: unknown): Request {
  return new Request('http://localhost/api/connections/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/connections/validate', () => {
  beforeEach(() => {
    mockCaller = null;
    health.mockResolvedValue({ status: 'ok' });
    status.mockResolvedValue({ authValid: true });
  });

  it('non-admin → 403, unauthenticated → 401', async () => {
    mockCaller = { id: 'm', username: 'm', displayName: 'M', avatarTint: '#9a6b4f', isAdmin: false };
    expect((await POST(req({ type: 'mma' }) as never)).status).toBe(403);
    mockCaller = null;
    expect((await POST(req({ type: 'mma' }) as never)).status).toBe(401);
  });

  it('admin + bad type → 400', async () => {
    mockCaller = asAdmin();
    expect((await POST(req({ type: 'nope' }) as never)).status).toBe(400);
  });

  it('mma: ok when reachable + bearer valid', async () => {
    mockCaller = asAdmin();
    expect(await (await POST(req({ type: 'mma' }) as never)).json()).toEqual({ ok: true, detail: 'Connected to mma.' });
  });

  it('mma: not ok when unreachable', async () => {
    mockCaller = asAdmin();
    health.mockResolvedValue({ status: 'unreachable' as never });
    expect(await (await POST(req({ type: 'mma' }) as never)).json()).toEqual({ ok: false, detail: 'Cannot reach mma.' });
  });

  it('mma: not ok when the bearer is rejected', async () => {
    mockCaller = asAdmin();
    status.mockResolvedValue({ authValid: false });
    const body = await (await POST(req({ type: 'mma' }) as never)).json();
    expect(body.ok).toBe(false);
    expect(body.detail).toMatch(/rejected the bearer/i);
  });

  it('git: probes with the typed token (no DB read)', async () => {
    mockCaller = asAdmin();
    const body = await (await POST(req({ type: 'git', token: 'ghp_x' }) as never)).json();
    expect(body).toEqual({ ok: true, detail: 'Git reachable.' });
    expect(probeGit).toHaveBeenCalledWith('ghp_x');
  });

  it('openai: probes with the typed key (no DB read)', async () => {
    mockCaller = asAdmin();
    const body = await (await POST(req({ type: 'openai', token: 'sk_x' }) as never)).json();
    expect(body).toEqual({ ok: true, detail: 'OpenAI key valid.' });
    expect(probeOpenai).toHaveBeenCalledWith('sk_x', null);
  });
});
