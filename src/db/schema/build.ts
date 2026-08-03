import { uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { EXPORT_FORMAT } from '@/db/enums';
import { forge } from '@/db/schema/_schema';
import { project } from '@/db/schema/projects';

/**
 * `project_export` (schema.md §6) — one row per export. All three formats are live: `md`
 * streams the per-stage raw markdown, `pdf` renders through `export/pdf`, `bundle` zips a
 * set. For the streamed `md` download `file_path` is a LOGICAL served attachment filename
 * `<kind>-v<version>.md` (no on-disk file is written for that path).
 *
 * The variable is `exportRecord` because `export` is a JS keyword; the table is
 * `project_export` (the doc used to say the table was named `export`).
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
    format: text('format', { enum: EXPORT_FORMAT }).notNull(),
    filePath: text('file_path').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('export_project_idx').on(t.projectId, t.createdAt.desc())],
);
