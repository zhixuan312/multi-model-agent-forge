import { integer, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { project } from '@/db/schema/projects';

export const projectJournal = forge.table(
  'project_journal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    heading: text('heading').notNull(),
    body: text('body').notNull(),
    type: text('type', { enum: ['decision', 'design', 'behavior', 'process', 'knowledge', 'style'] }).notNull(),
    topic: text('topic').notNull(),
    status: text('status', { enum: ['proposed', 'kept', 'removed', 'recorded'] }).notNull(),
    seq: integer('seq').notNull(),
    recordedNodeId: text('recorded_node_id'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_journal_project_seq_idx').on(t.projectId, t.seq),
  ],
);
