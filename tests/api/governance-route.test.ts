// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

let mockCaller: AuthedMember | null = null;
const getComponentGovernanceView = vi.fn(async () => ({ slots: [] }));
const updateComponentGovernance: any = vi.fn(async () => {
  return { kind: 'saved' as const, governance: { slots: [] } };
});

vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

vi.mock('@/config/component-governance-core', () => ({
  getComponentGovernanceView,
  updateComponentGovernance,
}));

const { GET, PUT } = await import('../../app/api/governance/route');

function req(body: unknown): Request {
  return new Request('http://localhost/api/governance', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET/PUT /api/governance', () => {
  beforeEach(() => {
    mockCaller = null;
    getComponentGovernanceView.mockClear();
    updateComponentGovernance.mockClear();
  });

  it('GET rejects unauthenticated callers with 401', async () => {
    expect((await GET()).status).toBe(401);
  });

  it('GET rejects authenticated non-org-admin callers with 403', async () => {
    mockCaller = { id: 'm1', username: 'member', displayName: 'Member', avatarTint: '#9a6b4f', role: 'member', teamId: 'team-1' };
    expect((await GET()).status).toBe(403);
  });

  it('PUT returns 400 for invalid governance payloads', async () => {
    mockCaller = { id: 'a1', username: 'admin', displayName: 'Admin', avatarTint: '#9a6b4f', role: 'org_admin', teamId: null };
    updateComponentGovernance.mockResolvedValueOnce({ kind: 'invalid' as const, message: 'Invalid governance fields.' });
    expect((await PUT(req({ slots: { badge: { locked: true, knobs: { variant: 'nope' } } } }) as never)).status).toBe(400);
  });

  it('GET returns 200 with the governance view for an org_admin', async () => {
    mockCaller = { id: 'a1', username: 'admin', displayName: 'Admin', avatarTint: '#9a6b4f', role: 'org_admin', teamId: null };
    const slots = [{ slotId: 'badge' }];
    getComponentGovernanceView.mockResolvedValueOnce({ slots } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(getComponentGovernanceView).toHaveBeenCalled();
    expect(await res.json()).toEqual({ slots });
  });

  it('PUT persists a valid slot patch for an org_admin and returns 200', async () => {
    mockCaller = { id: 'a1', username: 'admin', displayName: 'Admin', avatarTint: '#9a6b4f', role: 'org_admin', teamId: null };
    const governance = { slots: [{ slotId: 'stageLayout', locked: true, knobs: { mode: 'fullWidth' } }] };
    updateComponentGovernance.mockResolvedValueOnce({ kind: 'saved' as const, governance });
    const res = await PUT(req({ slots: { stageLayout: { locked: true, knobs: { mode: 'fullWidth' } } } }) as never);
    expect(res.status).toBe(200);
    expect(updateComponentGovernance).toHaveBeenCalledWith(
      { slots: { stageLayout: { locked: true, knobs: { mode: 'fullWidth' } } } },
    );
    expect(await res.json()).toEqual(governance);
  });
});
