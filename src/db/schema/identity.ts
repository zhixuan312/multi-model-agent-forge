import { uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { team } from '@/db/schema/team';
import { TEAM_ROLE } from '@/db/enums';

export const member = forge.table(
  'team_member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    avatarTint: text('avatar_tint').notNull().default('#9a6b4f'),
    role: text('role', { enum: TEAM_ROLE }).notNull(),
    teamId: uuid('team_id').references(() => team.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('member_username_lower_uniq').on(sql`lower(${t.username})`)],
);

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
  (t) => [index('session_member_idx').on(t.memberId), index('session_token_idx').on(t.tokenHash)],
);

export const appSecrets = forge.table('team_secret', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  valueEnc: text('value_enc').notNull(),
  createdBy: uuid('created_by').references(() => member.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const connectionSettings = forge.table(
  'team_connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mmaBaseUrl: text('mma_base_url'),
    openaiTranscriptionKeyRef: text('openai_transcription_key_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [uniqueIndex('settings_connection_singleton').on(sql`(true)`)],
);

