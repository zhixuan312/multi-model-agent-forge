import { uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { project } from '@/db/schema/projects';

/**
 * `export` (begin) (schema.md §6 / Spec 7) — created now; only the `md` path is
 * exercised (the per-stage raw-markdown download). `pdf`/`bundle` are reserved
 * for Spec 8. For the streamed `md` download `file_path` is a LOGICAL served
 * attachment filename `<kind>-v<version>.md` (no on-disk file is written here).
 *
 * Drizzle reserves no identifier here, but `export` is a JS keyword — the table
 * variable is `exportRecord` while the DB table name stays `export`.
 */
export const exportRecord = forge.table(
  'project_export',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    artifactKind: text('artifact_kind').notNull(),
    artifactVersion: integer('artifact_version'),
    format: text('format', { enum: ['md', 'pdf', 'bundle'] }).notNull(),
    filePath: text('file_path').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('export_project_idx').on(t.projectId, t.createdAt.desc())],
);
