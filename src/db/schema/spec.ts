import { uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';

/**
 * `project_qa_message` — shared chat transcript for spec components AND plan tasks.
 * `target_id` references team_spec_template.id (spec components) or plan task UUID (plan tasks).
 * `target_kind` disambiguates: 'spec_component' or 'plan_task'.
 */
export const qaMessage = forge.table(
  'project_qa_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetId: uuid('target_id'),
    projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    targetKind: text('target_kind'),
    seq: integer('seq').notNull(),
    bodyMd: text('body_md').notNull(),
    meta: jsonb('meta'),
    authorId: uuid('author_id').references(() => member.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('qa_message_target_seq_idx').on(t.targetId, t.seq)],
);
