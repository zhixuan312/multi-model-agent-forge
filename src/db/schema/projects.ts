import { uuid, text, boolean, integer, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { repo } from '@/db/schema/workspace';
import {
  PROJECT_VISIBILITY,
  PROJECT_PHASE,
  STAGE_KIND,
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
    summary: text('summary'),
    intentMd: text('intent_md'),
    briefMd: text('brief_md'),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => member.id),
    visibility: text('visibility', { enum: PROJECT_VISIBILITY }).notNull(),
    phase: text('phase', { enum: PROJECT_PHASE }).notNull().default('design'),
    currentStage: text('current_stage', { enum: STAGE_KIND }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    autoMode: boolean('auto_mode').notNull().default(false),
    autoNote: text('auto_note'),
    details: jsonb('details'),
    detailsVersion: integer('details_version').notNull().default(0),
    detailsReady: boolean('details_ready').notNull().default(false),
  },
  (t) => [
    index('project_owner_idx').on(t.ownerId),
    index('project_phase_idx').on(t.phase),
    index('project_updated_idx').on(t.updatedAt.desc()),
  ],
);

/**
 * `project_build_pr` — one PR per repo per project. Replaces the old
 * `project.build_prs` JSONB blob with a proper relational table.
 */
export const buildPr = forge.table(
  'project_build_pr',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repo.id),
    url: text('url').notNull(),
    branch: text('branch').notNull(),
    targetBranch: text('target_branch').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('build_pr_project_idx').on(t.projectId),
    unique('build_pr_project_repo_uniq').on(t.projectId, t.repoId),
  ],
);

export type BuildPrRow = typeof buildPr.$inferSelect;

export type ProjectRow = typeof project.$inferSelect;
