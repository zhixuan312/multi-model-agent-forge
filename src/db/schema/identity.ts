import { uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { AUTH_PROVIDER } from '@/db/enums';

/**
 * `member` — pure identity, no credentials. Auth lives in `member_identity` so
 * Forge can grow to SSO without touching `member`. `is_admin` is a single
 * capability flag (gates Team Settings + repo cloning only), not RBAC.
 */
export const member = forge.table(
  'iam_member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // stored as-typed; uniqueness is case-insensitive — see the functional index below (F4/F14)
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    // hex, picked on profile; defaulted at creation so seed + add-member need not supply it (F21)
    avatarTint: text('avatar_tint').notNull().default('#9a6b4f'),
    // gates Team Settings + repo cloning only
    isAdmin: boolean('is_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Case-INSENSITIVE uniqueness (F4/F14): a plain UNIQUE on `username` is case-sensitive and would let
    // 'Alice' and 'alice' coexist, after which the case-insensitive login lookup is ambiguous and the
    // "one login per user" guarantee fails. Enforce on lower(username) via a functional unique index.
    uniqueIndex('member_username_lower_uniq').on(sql`lower(${t.username})`),
  ],
);

/**
 * `iam_identity` — auth for a member. v1: every member has exactly one `local`
 * identity (password_hash set). The one-local-identity-per-member rule is
 * enforced in app code (LocalAuthProvider / Members-CRUD). The external-SSO seam
 * (provider_account_id + a metadata claims blob) was removed as unused; add it
 * back if/when external auth lands.
 */
export const memberIdentity = forge.table(
  'iam_identity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: AUTH_PROVIDER }).notNull(), // only 'local' built now
    passwordHash: text('password_hash'), // argon2id — local only
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }), // bump → drop all sessions
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('member_identity_member_idx').on(t.memberId)],
);

/**
 * `session` — auth-method-agnostic, opaque, server-stored. Store the sha256
 * hash, never the token. Sliding idle-expiry via last_used_at; absolute max
 * lifetime via expires_at. Server-side store makes the cookie instantly revocable.
 */
export const session = forge.table(
  'iam_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(), // sha256 of the opaque cookie token
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(), // sliding idle-expiry
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // absolute max lifetime
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('session_member_idx').on(t.memberId),
    index('session_token_idx').on(t.tokenHash),
  ],
);
