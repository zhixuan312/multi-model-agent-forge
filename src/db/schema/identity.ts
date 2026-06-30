import { uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';

/**
 * `team_member` — pure identity, no credentials. Auth lives in `team_identity` so
 * Forge can grow to SSO without touching `member`. `is_admin` is a single
 * capability flag (gates Team Settings + repo cloning only), not RBAC.
 */
export const member = forge.table(
  'team_member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    avatarTint: text('avatar_tint').notNull().default('#9a6b4f'),
    isAdmin: boolean('is_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('member_username_lower_uniq').on(sql`lower(${t.username})`),
  ],
);

/**
 * `team_identity` — auth for a member. v1: every member has exactly one identity
 * (password_hash set), `local` password auth only.
 */
export const memberIdentity = forge.table(
  'team_identity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    passwordHash: text('password_hash'),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('member_identity_member_idx').on(t.memberId)],
);

/**
 * `team_session` — auth-method-agnostic, opaque, server-stored. Store the sha256
 * hash, never the token. Sliding idle-expiry via last_used_at; absolute max
 * lifetime via expires_at (30 days). Idle sessions older than 24 hours are
 * rejected regardless of last_used_at.
 */
export const session = forge.table(
  'team_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('session_member_idx').on(t.memberId),
    index('session_token_idx').on(t.tokenHash),
  ],
);

/**
 * `team_secret` — encrypted secret store; the target of every `*_ref`.
 *
 * `value_enc` is base64(nonce ‖ ciphertext) from libsodium `crypto_secretbox`,
 * keyed by the single 32-byte `FORGE_SECRET_KEY` master key. Decryption is
 * server-side only, on demand, never reaching the browser.
 */
export const appSecrets = forge.table('team_secret', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  valueEnc: text('value_enc').notNull(),
  createdBy: uuid('created_by').references(() => member.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `team_connection` — singleton (one row). Holds the Connections config: the
 * MMA base URL, the git token ref, and the speech-to-text (OpenAI) key ref.
 *
 * Bootstrap: `pnpm db:seed` creates the initial row. Reads must handle the
 * missing-row case gracefully (return NULL defaults). The unique-on-true index
 * prevents duplicate rows from concurrent bootstrap attempts.
 */
export const connectionSettings = forge.table(
  'team_connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mmaBaseUrl: text('mma_base_url'),
    gitTokenRef: text('git_token_ref'),
    openaiTranscriptionKeyRef: text('openai_transcription_key_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [uniqueIndex('settings_connection_singleton').on(sql`(true)`)],
);
