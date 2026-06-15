// @vitest-environment node
// Unit-level proof (no DB) that BOTH login paths run a full argon2id verify:
// the unknown-user path verifies against the dummy hash rather than returning
// early (Spec 1 Timing-equality / F1). We inject a fake Db so no Postgres is hit.
import { vi } from 'vitest';
import * as passwordMod from '@/auth/password';
import { LocalAuthProvider } from '@/auth/auth-provider';
import { DUMMY_ARGON2_HASH } from '@/auth/password';
import type { Db } from '@/db/client';

/** A Db stub whose select-chain resolves to the given rows. */
function fakeDb(rows: unknown[]): Db {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: async () => rows,
  };
  return { select: () => chain } as unknown as Db;
}

describe('LocalAuthProvider timing-equality (unit, no DB)', () => {
  it('runs a full argon2id verify against the DUMMY hash on the unknown-user path', async () => {
    const spy = vi.spyOn(passwordMod, 'verifyPassword');
    const provider = new LocalAuthProvider(fakeDb([])); // no member found
    const res = await provider.authenticate('ghost', 'whatever-1234');
    expect(res).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('whatever-1234', DUMMY_ARGON2_HASH);
    spy.mockRestore();
  });

  it('runs verify against the stored hash on the known-user path', async () => {
    const spy = vi.spyOn(passwordMod, 'verifyPassword');
    const realHash = await passwordMod.hashPassword('the-real-password');
    const provider = new LocalAuthProvider(
      fakeDb([
        {
          id: 'm1',
          username: 'alice',
          displayName: 'Alice',
          avatarTint: '#9a6b4f',
          isAdmin: false,
          passwordHash: realHash,
        },
      ]),
    );
    const res = await provider.authenticate('alice', 'the-real-password');
    expect(res?.id).toBe('m1');
    expect(spy).toHaveBeenCalledWith('the-real-password', realHash);
    spy.mockRestore();
  });

  it('returns null for a known user when the password does not verify', async () => {
    const realHash = await passwordMod.hashPassword('the-real-password');
    const provider = new LocalAuthProvider(
      fakeDb([
        { id: 'm1', username: 'alice', displayName: 'Alice', avatarTint: '#9a6b4f', isAdmin: false, passwordHash: realHash },
      ]),
    );
    expect(await provider.authenticate('alice', 'WRONG-password')).toBeNull();
  });
});
