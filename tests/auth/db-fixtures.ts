// Shared live-DB fixtures for auth integration tests. Every member created
// here uses the throwaway username prefix so cleanup is exhaustive and never
// touches real rows. ON DELETE CASCADE removes member_identity + session.
import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { member, memberIdentity } from '@/db/schema/identity';
import { hashPassword } from '@/auth/password';

/** Unique-per-run prefix; cleanup deletes every member whose username starts here. */
export const TEST_USERNAME_PREFIX = '__forge_test__';

export function uniqueUsername(label = 'user'): string {
  return `${TEST_USERNAME_PREFIX}${label}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export interface SeededMember {
  id: string;
  username: string;
  password: string;
}

/** Insert a throwaway member + its local identity with a known password. */
export async function seedTestMember(opts?: {
  password?: string;
  isAdmin?: boolean;
  label?: string;
}): Promise<SeededMember> {
  const db = getDb();
  const username = uniqueUsername(opts?.label);
  const password = opts?.password ?? 'test-password-1234';
  const [m] = await db
    .insert(member)
    .values({ username, displayName: username, isAdmin: opts?.isAdmin ?? false })
    .returning({ id: member.id });
  await db.insert(memberIdentity).values({
    memberId: m.id,
    provider: 'local',
    passwordHash: await hashPassword(password),
  });
  return { id: m.id, username, password };
}

/** Delete every throwaway member (cascade clears identities + sessions). */
export async function cleanupTestMembers(): Promise<void> {
  const db = getDb();
  await db.delete(member).where(sql`${member.username} LIKE ${TEST_USERNAME_PREFIX + '%'}`);
}

/**
 * NOTE: do NOT close the shared pool from a per-file afterAll. `getSql()` caches
 * a single process-wide postgres-js pool; closing it would break the remaining
 * test files (they run sequentially in one worker — see vitest.config.ts
 * `fileParallelism: false`). Vitest terminates the worker at the end of the run,
 * which tears the pool down. This helper is intentionally retained as a no-op so
 * existing afterAll hooks read clearly and a future single-file run can opt in.
 */
export async function closeDb(): Promise<void> {
  // intentionally a no-op (see note above)
}
