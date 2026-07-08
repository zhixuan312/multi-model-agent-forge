// @vitest-environment node
import { assertAdmin, NotAdminError, NotAuthenticatedError } from '@/auth/require-admin';
import type { AuthedMember } from '@/auth/auth-provider';

const base: AuthedMember = {
  id: 'm1',
  username: 'alice',
  displayName: 'Alice',
  avatarTint: '#9a6b4f',
  role: 'member',
  teamId: 'team-1',
};

describe('assertAdmin', () => {
  it('allows org_admin and team_admin', () => {
    expect(assertAdmin({ ...base, role: 'org_admin', teamId: null }).role).toBe('org_admin');
    expect(assertAdmin({ ...base, role: 'team_admin' }).role).toBe('team_admin');
  });

  it('rejects a non-admin role', () => {
    expect(() => assertAdmin(base)).toThrow(NotAdminError);
  });

  it('rejects unauthenticated callers', () => {
    expect(() => assertAdmin(null)).toThrow(NotAuthenticatedError);
  });
});
