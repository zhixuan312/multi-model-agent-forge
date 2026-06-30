import { uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';
import { LEARNING_TYPE, LEARNING_ORIGIN, LEARNING_STATUS } from '@/db/enums';

/**
 * `project_learning_candidate` — the curation set for learnings harvested from
 * a project run. proposed→kept/removed→recorded. `recorded_node_id` is the MMA
 * journal node id after a journal-record write.
 */
export const learningCandidate = forge.table(
  'project_learning_candidate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    type: text('type', { enum: LEARNING_TYPE }).notNull(),
    origin: text('origin', { enum: LEARNING_ORIGIN }).notNull(),
    status: text('status', { enum: LEARNING_STATUS }).notNull().default('proposed'),
    recordedNodeId: text('recorded_node_id'),
    createdBy: uuid('created_by').references(() => member.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('learning_candidate_project_idx').on(t.projectId)],
);

export type LearningCandidateRow = typeof learningCandidate.$inferSelect;
