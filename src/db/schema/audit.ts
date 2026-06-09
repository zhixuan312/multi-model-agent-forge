import { uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';

/**
 * `action_log` (schema.md §10) — the domain accountability trail (distinct from
 * the operational `logEvent` logger). One row per project mutation under the
 * shared agent credential; the *member* is the human who acted. `project_id` is
 * NULLABLE (team-level actions have no project). The spec prefers a `uuidv7()`
 * id (insert-order-sortable) but Spec-1 never shipped that helper — every table
 * in this codebase uses `gen_random_uuid()`, so this follows suit. Chronological
 * reads are served by the (project_id, created_at desc) index regardless of id
 * ordering. `action`/`target` are free-form text (not enums).
 */
export const actionLog = forge.table(
  'action_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => project.id), // NULL = team-level
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id),
    action: text('action').notNull(), // e.g. create_project, change_visibility, change_repos
    target: text('target'), // e.g. project:<id>, repo:<id>
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('action_log_project_created_idx').on(t.projectId, t.createdAt.desc())],
);

export type ActionLogRow = typeof actionLog.$inferSelect;
