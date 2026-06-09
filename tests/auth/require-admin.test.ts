// @vitest-environment node
import { assertAdmin, NotAdminError, NotAuthenticatedError } from '@/auth/require-admin';
import type { AuthedMember } from '@/auth/auth-provider';

const base: AuthedMember = {
  id: 'm1',
  username: 'alice',
  displayName: 'Alice',
  avatarTint: '#9a6b4f',
  isAdmin: false,
};

describe('assertAdmin', () => {
  it('allows an admin member through', () => {
    const admin = { ...base, isAdmin: true };
    expect(assertAdmin(admin)).toBe(admin);
  });

  it('denies a non-admin with NotAdminError (403)', () => {
    try {
      assertAdmin(base);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NotAdminError);
      expect((e as NotAdminError).status).toBe(403);
    }
  });

  it('denies an unauthenticated caller with NotAuthenticatedError (401)', () => {
    try {
      assertAdmin(null);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NotAuthenticatedError);
      expect((e as NotAuthenticatedError).status).toBe(401);
    }
  });
});
