import { uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';
import { PARTICIPANT_SCOPE, PARTICIPANT_ROLE } from '@/db/enums';

/**
 * `project_participant` — unified participation and approval tracking.
 *
 * Every project has exactly one owner (the creator). Other members are invited
 * per-stage or per-entity (component, task) by the owner.
 *
 * Scope semantics:
 *   scope='project', scope_id=NULL, role='owner' → sole creator (exactly 1 per project)
 *   scope='stage',     scope_id=stage.id         → invited to participate in a stage
 *   scope='component', scope_id=component.id     → spec component reviewer/approver
 *   scope='task',      scope_id=planTask.id      → plan task reviewer/approver
 *
 * Validation rules:
 *   scope='project' requires scope_id IS NULL; other scopes require scope_id IS NOT NULL.
 *   The referenced entity must exist and belong to the same project_id.
 */
export const participant = forge.table(
  'project_participant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id),
    scope: text('scope', { enum: PARTICIPANT_SCOPE }).notNull(),
    scopeId: uuid('scope_id'),
    role: text('role', { enum: PARTICIPANT_ROLE }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('participant_project_scope_idx').on(t.projectId, t.scope),
    index('participant_member_idx').on(t.memberId),
    uniqueIndex('participant_dedup_idx').on(
      t.projectId,
      t.memberId,
      t.scope,
      sql`COALESCE(${t.scopeId}, '00000000-0000-0000-0000-000000000000')`,
      t.role,
    ),
    uniqueIndex('participant_sole_owner_idx')
      .on(t.projectId)
      .where(sql`${t.scope} = 'project' AND ${t.role} = 'owner'`),
  ],
);

export type ParticipantRow = typeof participant.$inferSelect;
