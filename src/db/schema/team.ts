import { uuid, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';

export const team = forge.table('team', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  workspaceRootPath: text('workspace_root_path').notNull(),
  gitTokenRef: text('git_token_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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

export type TeamRow = typeof team.$inferSelect;
export type TeamSpecTemplateRow = typeof teamSpecTemplate.$inferSelect;
