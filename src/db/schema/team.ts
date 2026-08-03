import { uuid, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';

export const team = forge.table('team', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /**
   * The team's workspace root RELATIVE to the operator base
   * (`FORGE_WORKSPACE_BASE`) — normally just the leaf directory name. Storing it
   * relative is what makes a database dump portable between hosts whose bases
   * differ (a container's `/workspace` vs a host's `/root/forge-workspace`).
   * Resolve it with `resolveTeamWorkspaceRoot()`, which also still honours a
   * legacy absolute value written before migration 0019.
   */
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
