import { integer, uniqueIndex, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { project } from '@/db/schema/projects';
import { JOURNAL_LEARNING_STATUS, LEARNING_CATEGORIES } from '@/db/enums';

export const projectJournal = forge.table(
  'project_journal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    heading: text('heading').notNull(),
    body: text('body').notNull(),
    type: text('type', { enum: LEARNING_CATEGORIES }).notNull(),
    topic: text('topic').notNull(),
    status: text('status', { enum: JOURNAL_LEARNING_STATUS }).notNull(),
    seq: integer('seq').notNull(),
    recordedNodeId: text('recorded_node_id'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Unique so a project's (proposed→recorded) rows keep a stable, gap-free order AND
    // the count-then-insert backfill/harvest can't duplicate rows under a concurrent rerun.
    uniqueIndex('project_journal_project_seq_idx').on(t.projectId, t.seq),
  ],
);
