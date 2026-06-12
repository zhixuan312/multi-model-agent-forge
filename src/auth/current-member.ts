import { cookies } from 'next/headers';
import { eq, and, max } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { member, memberIdentity } from '@/db/schema/identity';
import { SESSION_COOKIE_NAME } from '@/auth/cookie';
import { SESSION_IDLE_TTL_MS } from '@/auth/config';
import {
  sessionStore,
  type SessionStore,
  type SessionRecord,
} from '@/auth/session-store';
import type { AuthedMember } from '@/auth/auth-provider';
import { USE_MOCK } from '@/mock/config';

/** Seeded admin returned in mock mode so the harness runs with no DB / session.
 *  Matches the `admin` owner in the projects dashboard mock. */
const MOCK_MEMBER: AuthedMember = {
  id: '5bf0cfe8-ad4d-47fd-903a-74fa5d2c6fea',
  username: 'admin',
  displayName: 'admin',
  avatarTint: '#c4521e',
  isAdmin: true,
};

/**
 * Full session validation (Node runtime). The Edge middleware only does a
 * stateless cookie-presence pre-check; THIS is the authoritative validation,
 * called inside RSC layouts and route handlers.
 *
 * Reject when the session is: missing / absolute-expired (handled in
 * `SessionStore.get`) / idle-expired (`now - last_used_at > SESSION_IDLE_TTL`)
 * / member gone / password rotated (`password_changed_at` newer than
 * `session.created_at`). On valid → slide `last_used_at` (idle window resets).
 */
export interface ResolvedSession {
  member: AuthedMember;
  session: SessionRecord;
}

export interface ResolveDeps {
  store?: SessionStore;
  db?: Db;
  now?: () => number;
}

/**
 * Core, dependency-injected validation given a raw token. Returns the member +
 * session on success, or null on any rejection. Pure of `next/headers` so it's
 * unit-testable against the live DB.
 */
export async function resolveSessionFromToken(
  token: string | undefined,
  deps: ResolveDeps = {},
): Promise<ResolvedSession | null> {
  if (!token || token.trim() === '') return null;
  const store = deps.store ?? sessionStore;
  const db = deps.db ?? getDb();
  const now = deps.now ?? Date.now;

  const sess = await store.get(token); // null when missing or absolute-expired
  if (!sess) return null;

  // Idle-expiry — an EXPLICIT rejection condition (F2). Sliding last_used_at
  // alone does not expire anything; this comparison does.
  if (now() - sess.lastUsedAt.getTime() > SESSION_IDLE_TTL_MS) {
    return null;
  }

  // Resolve the member + its newest local password_changed_at.
  const [row] = await db
    .select({
      id: member.id,
      username: member.username,
      displayName: member.displayName,
      avatarTint: member.avatarTint,
      isAdmin: member.isAdmin,
      passwordChangedAt: max(memberIdentity.passwordChangedAt),
    })
    .from(member)
    .leftJoin(
      memberIdentity,
      and(eq(memberIdentity.memberId, member.id), eq(memberIdentity.provider, 'local')),
    )
    .where(eq(member.id, sess.memberId))
    .groupBy(member.id)
    .limit(1);

  if (!row) return null; // member gone

  // Password-rotation drop: a password change bumps password_changed_at, which
  // invalidates every session created before it (F11/F19).
  if (row.passwordChangedAt && row.passwordChangedAt.getTime() > sess.createdAt.getTime()) {
    return null;
  }

  // Valid → slide the idle window.
  await store.touch(sess.id);

  return {
    member: {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatarTint: row.avatarTint,
      isAdmin: row.isAdmin,
    },
    session: sess,
  };
}

/** Read the session cookie and resolve the current member (RSC / handlers). */
export async function currentMember(): Promise<AuthedMember | null> {
  if (USE_MOCK) return MOCK_MEMBER;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  const resolved = await resolveSessionFromToken(token);
  return resolved?.member ?? null;
}

/** Like `currentMember` but returns the session too (for re-issue/logout flows). */
export async function currentSession(): Promise<ResolvedSession | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  return resolveSessionFromToken(token);
}
