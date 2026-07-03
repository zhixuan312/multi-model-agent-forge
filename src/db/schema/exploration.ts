import { uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';
import { ATTACHMENT_KIND } from '@/db/enums';

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

export type AttachmentRow = typeof attachment.$inferSelect;
