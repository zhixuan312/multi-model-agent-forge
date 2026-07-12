import {
  bigserial,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';

export const projectActivity = forge.table(
  'project_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    stage: text('stage').notNull(),
    phase: text('phase').notNull(),
    label: text('label').notNull(),
    kind: text('kind', { enum: ['action', 'running', 'done', 'error'] }).notNull(),
    actorId: uuid('actor_id').references(() => member.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull(),
    actorTint: text('actor_tint').notNull(),
    source: text('source', { enum: ['user', 'mma'] }).notNull(),
    durationMs: integer('duration_ms'),
    eventKey: text('event_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_activity_project_seq_idx').on(t.projectId, t.seq),
    uniqueIndex('project_activity_project_event_key_uniq')
      .on(t.projectId, t.eventKey)
      .where(sql`${t.eventKey} IS NOT NULL`),
  ],
);

export type ProjectActivityRow = typeof projectActivity.$inferSelect;
export type NewProjectActivityRow = typeof projectActivity.$inferInsert;
