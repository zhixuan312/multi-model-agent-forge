import { uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { mmaBatch } from '@/db/schema/mma';
import { ATTACHMENT_KIND, EXPLORATION_TASK_KIND, EXPLORATION_TASK_STATUS } from '@/db/enums';

/**
 * `project_attachment` (schema.md §4) — brief inputs (links, images, files). For
 * image/file the stored `payload.path` is ALWAYS server-generated under the
 * traversal/symlink-checked workspace attachment area — never client-supplied.
 * Bytes are never sent to MMA; only label/url text folds into a research task's
 * background. CASCADE-deletes with the project (on-disk bytes cleaned up by a
 * Forge-owned unlink helper, since CASCADE cannot reach the filesystem).
 */
export const attachment = forge.table('project_attachment', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ATTACHMENT_KIND }).notNull(),
  label: text('label').notNull(),
  payload: jsonb('payload').notNull(), // {url} | {path,size} | file ref
  createdBy: uuid('created_by')
    .notNull()
    .references(() => member.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `project_exploration_task` (schema.md §4) — the editable fan-out task. `status`:
 * draft → running → recorded (terminal, LOCKED). There is no `failed` value;
 * per-task failure is derived from the joined `mma_batch.status`. The
 * conditional invariant (`kind='investigate' ⇒ target_repo_id required, else
 * null`) is enforced in the Zod input layer, not the DB.
 */
export const explorationTask = forge.table('project_exploration_task', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: EXPLORATION_TASK_KIND }).notNull(),
  targetRepoId: uuid('target_repo_id').references(() => repo.id), // investigate only; null otherwise
  prompt: text('prompt').notNull(),
  status: text('status', { enum: EXPLORATION_TASK_STATUS }).notNull().default('draft'),
  mmaBatchId: uuid('mma_batch_id').references(() => mmaBatch.id), // the dispatch
  createdBy: uuid('created_by')
    .notNull()
    .references(() => member.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AttachmentRow = typeof attachment.$inferSelect;
export type ExplorationTaskRow = typeof explorationTask.$inferSelect;
