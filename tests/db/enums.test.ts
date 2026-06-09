import { z } from 'zod';
import { AUTH_PROVIDER, type AuthProvider } from '@/db/enums';

describe('db/enums', () => {
  it('AUTH_PROVIDER contains exactly the canonical Spec-1 values', () => {
    // schema.md §1: only `local` is built now (ldap/oidc/saml/supabase land with strategies).
    expect([...AUTH_PROVIDER]).toEqual(['local']);
  });

  it('AUTH_PROVIDER is a readonly tuple (as const)', () => {
    // A const tuple is frozen at the type level; the runtime array still exists.
    // The compile-time `as const` is what gives us the literal union below.
    const provider: AuthProvider = 'local';
    expect(provider).toBe('local');
  });

  it('derives a Zod enum that accepts canonical values and rejects others', () => {
    const schema = z.enum(AUTH_PROVIDER);
    expect(schema.parse('local')).toBe('local');
    expect(schema.safeParse('oidc').success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
  });
});
