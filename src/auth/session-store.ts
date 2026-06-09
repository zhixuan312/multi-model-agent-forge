import { and, eq, lt, ne } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { session } from '@/db/schema/identity';
import { hashToken } from '@/auth/cookie';
import { SESSION_ABSOLUTE_TTL_MS } from '@/auth/config';

/**
 * A stored session row (server-side; the cookie holds only the opaque token).
 */
export interface SessionRecord {
  id: string;
  memberId: string;
  tokenHash: string;
  lastUsedAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

/** The result of creating a session: the row plus the RAW token for the cookie. */
export interface CreatedSession {
  token: string;
  record: SessionRecord;
}

/**
 * The portable session-storage seam (Spec 1 §why). `create/get/touch/revoke`.
 * A Postgres impl ships now; a Redis impl drops in behind this interface when
 * SSE fan-out lands (Spec 5) with no call-site change.
 *
 * `get` enforces the ABSOLUTE expiry (`expires_at`) only — idle-expiry and the
 * password-rotation check live in `current-member.ts`, which composes this
 * store. Keeping the idle/rotation policy out of the store keeps the seam thin
 * (a Redis impl needn't know about `member.password_changed_at`).
 */
export interface SessionStore {
  /** Create a session for a member; mint + return the raw token. The caller
   *  may pass a pre-minted token (tests) or let the store mint one. */
  create(memberId: string, opts?: { token?: string }): Promise<CreatedSession>;
  /** Resolve a live session by its RAW token. Returns null if absent or
   *  absolute-expired (`expires_at` in the past). */
  get(token: string): Promise<SessionRecord | null>;
  /** Slide `last_used_at = now()` for a session (idle-window reset). */
  touch(sessionId: string): Promise<void>;
  /** Remove a session row by id (logout / revoke). */
  revoke(sessionId: string): Promise<void>;
  /** Remove every OTHER session for a member (keeps `exceptSessionId`). Used by
   *  change-password's re-issue path. */
  revokeAllForMemberExcept(memberId: string, exceptSessionId: string): Promise<void>;
  /** Remove ALL sessions for a member (admin password-reset → force re-login). */
  revokeAllForMember(memberId: string): Promise<void>;
}

import { randomBytes } from 'node:crypto';

function defaultToken(): string {
  return randomBytes(32).toString('base64url');
}

export class PostgresSessionStore implements SessionStore {
  private readonly db: Db;
  constructor(db: Db = getDb()) {
    this.db = db;
  }

  async create(memberId: string, opts?: { token?: string }): Promise<CreatedSession> {
    const token = opts?.token ?? defaultToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TTL_MS);
    const [row] = await this.db
      .insert(session)
      .values({ memberId, tokenHash, expiresAt })
      .returning();
    return { token, record: toRecord(row) };
  }

  async get(token: string): Promise<SessionRecord | null> {
    const tokenHash = hashToken(token);
    const [row] = await this.db
      .select()
      .from(session)
      .where(eq(session.tokenHash, tokenHash))
      .limit(1);
    if (!row) return null;
    // Absolute-expiry: a past expires_at is dead.
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return toRecord(row);
  }

  async touch(sessionId: string): Promise<void> {
    await this.db
      .update(session)
      .set({ lastUsedAt: new Date() })
      .where(eq(session.id, sessionId));
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.delete(session).where(eq(session.id, sessionId));
  }

  async revokeAllForMemberExcept(memberId: string, exceptSessionId: string): Promise<void> {
    await this.db
      .delete(session)
      .where(and(eq(session.memberId, memberId), ne(session.id, exceptSessionId)));
  }

  async revokeAllForMember(memberId: string): Promise<void> {
    await this.db.delete(session).where(eq(session.memberId, memberId));
  }
}

/** Reap absolute-expired session rows (also usable for the cron reaper). */
export async function deleteExpiredSessions(db: Db = getDb()): Promise<number> {
  const deleted = await db
    .delete(session)
    .where(lt(session.expiresAt, new Date()))
    .returning({ id: session.id });
  return deleted.length;
}

function toRecord(row: typeof session.$inferSelect): SessionRecord {
  return {
    id: row.id,
    memberId: row.memberId,
    tokenHash: row.tokenHash,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** Process-shared store instance. */
export const sessionStore = new PostgresSessionStore();
