import { uuid, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';

export const teamSpecTemplate = forge.table(
  'team_spec_template',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull().unique(),
    label: text('label').notNull(),
    orderIndex: integer('order_index').notNull(),
    sections: jsonb('sections').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type TeamSpecTemplateRow = typeof teamSpecTemplate.$inferSelect;
