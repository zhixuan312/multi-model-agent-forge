import { uuid, text, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { AUTH_PROVIDER } from '@/db/enums';

/**
 * `member` — pure identity, no credentials. Auth lives in `member_identity` so
 * Forge can grow to SSO without touching `member`. `is_admin` is a single
 * capability flag (gates Team Settings + repo cloning only), not RBAC.
 */
export const member = forge.table(
  'member',
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
 * `member_identity` — pluggable auth. v1: every member has exactly one `local`
 * identity (provider_account_id NULL, password_hash set). The partial unique
 * index covers future external accounts; the one-local-identity-per-member rule
 * is enforced in app code (LocalAuthProvider / Members-CRUD).
 */
export const memberIdentity = forge.table(
  'member_identity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: AUTH_PROVIDER }).notNull(), // only 'local' built now
    providerAccountId: text('provider_account_id'), // external sub/DN; NULL for local
    passwordHash: text('password_hash'), // argon2id — local only
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }), // bump → drop all sessions
    metadata: jsonb('metadata'), // provider claims / profile
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // External-account uniqueness: one external (provider, account) → one identity.
    // PARTIAL — only enforced where provider_account_id IS NOT NULL, so the NULL-distinct
    // behaviour of Postgres does not let two local rows collide silently (F32).
    uniqueIndex('member_identity_provider_account_uniq')
      .on(t.provider, t.providerAccountId)
      .where(sql`${t.providerAccountId} IS NOT NULL`),
    index('member_identity_member_idx').on(t.memberId),
  ],
);

/**
 * `session` — auth-method-agnostic, opaque, server-stored. Store the sha256
 * hash, never the token. Sliding idle-expiry via last_used_at; absolute max
 * lifetime via expires_at. Server-side store makes the cookie instantly revocable.
 */
export const session = forge.table(
  'session',
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
