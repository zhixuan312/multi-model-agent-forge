import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { member, memberIdentity } from '@/db/schema/identity';
import { verifyPassword, DUMMY_ARGON2_HASH } from '@/auth/password';

export type ForgeRole = 'org_admin' | 'team_admin' | 'member';

/** A resolved authenticated member (no credentials). */
export interface AuthedMember {
  id: string;
  username: string;
  displayName: string;
  avatarTint: string;
  role: ForgeRole;
  teamId: string | null;
}

/**
 * The pluggable auth seam (Spec 1). `local` is the only strategy built now;
 * `member_identity` supports SSO strategies behind the same interface later.
 */
export interface AuthProvider {
  /** Authenticate credentials → member, or null on any failure. Must NOT reveal
   *  which of username/password was wrong (no user-enumeration). */
  authenticate(username: string, password: string): Promise<AuthedMember | null>;
}

export class LocalAuthProvider implements AuthProvider {
  private _db?: Db;
  // Lazy connection (resolved on first query) so the module-load `localAuthProvider`
  // singleton below doesn't require DATABASE_URL just to be imported.
  constructor(db?: Db) {
    this._db = db;
  }
  private get db(): Db {
    return (this._db ??= getDb());
  }

  async authenticate(username: string, password: string): Promise<AuthedMember | null> {
    // Case-INSENSITIVE lookup via the lower(username) functional unique index.
    const [row] = await this.db
      .select({
        id: member.id,
        username: member.username,
        displayName: member.displayName,
        avatarTint: member.avatarTint,
        role: member.role,
        teamId: member.teamId,
        passwordHash: memberIdentity.passwordHash,
      })
      .from(member)
      .leftJoin(memberIdentity, eq(memberIdentity.memberId, member.id))
      .where(sql`lower(${member.username}) = lower(${username})`)
      .limit(1);

    // Timing-equality (Spec 1): on the unknown-user path, verify against a fixed
    // dummy hash so the dominant argon2id cost is paid in BOTH cases — never
    // return early before the KDF. The result is discarded.
    if (!row || !row.passwordHash) {
      await verifyPassword(password, DUMMY_ARGON2_HASH);
      return null;
    }

    const ok = await verifyPassword(password, row.passwordHash);
    if (!ok) return null;

    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatarTint: row.avatarTint,
      role: row.role,
      teamId: row.teamId,
    };
  }
}

/** Process-shared provider instance. */
export const localAuthProvider = new LocalAuthProvider();
