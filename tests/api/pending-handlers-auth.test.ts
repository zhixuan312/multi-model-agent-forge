// @vitest-environment node
import { vi } from 'vitest';
import type { AuthedMember } from '@/auth/auth-provider';

// The pending-handlers GET mutates state (fails stale batches, pushes notifications, publishes
// to the project bus) yet previously had NO authentication — any cookie-bearing request could
// force-fail any project's batches. The auth gate short-circuits BEFORE any DB access, so it is
// verified DB-free (tests never touch a database — see tests/setup.ts).
let mockCaller: AuthedMember | null = null;
vi.mock('@/auth/current-member', () => ({
  currentMember: async () => mockCaller,
  currentSession: async () => null,
}));

const { GET } = await import('../../app/api/projects/[id]/pending-handlers/route');

function call(id = 'proj-1') {
  return GET(new Request('http://localhost/api/projects/proj-1/pending-handlers'), {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/projects/[id]/pending-handlers — auth gate', () => {
  beforeEach(() => {
    mockCaller = null;
  });

  it('unauthenticated → 401', async () => {
    mockCaller = null;
    expect((await call()).status).toBe(401);
  });

  it('authenticated but with no team → 401 (cannot form a project actor)', async () => {
    mockCaller = { id: 'oa', username: 'oa', displayName: 'OA', avatarTint: '#000', role: 'org_admin', teamId: null };
    expect((await call()).status).toBe(401);
  });
});
