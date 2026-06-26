import { uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';

export const notification = forge.table(
  'ops_notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id').references(() => member.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    sourceId: text('source_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notification_member_feed_idx').on(t.memberId, t.dismissedAt, t.createdAt),
    uniqueIndex('notification_source_dedup_idx').on(t.sourceId).where(sql`${t.sourceId} IS NOT NULL`),
  ],
);

export type NotificationRow = typeof notification.$inferSelect;
