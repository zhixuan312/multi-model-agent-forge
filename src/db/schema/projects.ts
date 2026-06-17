import { uuid, text, timestamp, index, primaryKey, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { repo } from '@/db/schema/workspace';
import {
  PROJECT_VISIBILITY,
  PROJECT_PHASE,
  PROJECT_MEMBER_ROLE,
  STAGE_KIND,
  STAGE_STATUS,
} from '@/db/enums';

/**
 * `project` (schema.md §3) — the container every later stage hangs off. `summary`
 * + `intent_md` ship now but are written by Spec 4 (NULL at create here).
 * `current_stage` is a resume pointer (set to `exploration` on create). PK uses
 * `gen_random_uuid()` (sorted by `updated_at desc`, not insert order).
 */
export const project = forge.table(
  'project',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    summary: text('summary'), // derived from intent_md by Spec 4; NULL here
    intentMd: text('intent_md'), // captured at start of Spec; NULL here
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => member.id),
    visibility: text('visibility', { enum: PROJECT_VISIBILITY }).notNull(),
    phase: text('phase', { enum: PROJECT_PHASE }).notNull().default('design'),
    currentStage: text('current_stage', { enum: STAGE_KIND }), // resume pointer
    frozenAt: timestamp('frozen_at', { withTimezone: true }), // set at freeze (Spec 4)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_owner_idx').on(t.ownerId),
    index('project_phase_idx').on(t.phase),
    index('project_updated_idx').on(t.updatedAt.desc()),
  ],
);

/**
 * `project_repo` (schema.md §3) — the chosen repo subset. Composite PK; cascades
 * on project delete. `repo_id → repo` has NO cascade (a dangling reference is
 * tolerated defensively via LEFT JOIN at read time).
 */
export const projectRepo = forge.table(
  'project_repo',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repo.id),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.repoId] })],
);

/**
 * `project_member` (schema.md §3) — private-project access. An `owner` row is
 * always seeded on create (uniform audit/ownership regardless of visibility);
 * `project_member` is only meaningful for private projects.
 */
export const projectMember = forge.table(
  'project_member',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id),
    role: text('role', { enum: PROJECT_MEMBER_ROLE }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.memberId] })],
);

/**
 * `project_stage` (schema.md §5) — the five-stage skeleton (one row per kind). Seeded on
 * create with `exploration=active`, the rest `pending`. UNIQUE (project_id, kind)
 * makes the seed idempotent (a retry can't double-seed). PK `gen_random_uuid()`.
 */
export const stage = forge.table(
  'project_stage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: STAGE_KIND }).notNull(),
    status: text('status', { enum: STAGE_STATUS }).notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [unique('stage_project_kind_uniq').on(t.projectId, t.kind)],
);

export type ProjectRow = typeof project.$inferSelect;
export type StageRow = typeof stage.$inferSelect;
