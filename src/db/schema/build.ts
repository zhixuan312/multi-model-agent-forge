import { uuid, text, boolean, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { mmaBatch } from '@/db/schema/mma';
import { BUILD_TASK_STATUS, REVIEW_POLICY } from '@/db/enums';

/**
 * `project_plan_task` (schema.md §8 / Spec 7) — the build plan + execute lanes.
 *
 * 7a fills queued rows (one `target_repo_id` per task; `review_policy` set at
 * authoring; `branch`/`commit_sha`/`fix_note` null). 7b consumes queued rows:
 * branch prep, dispatch, verify/fix, commit attribution, review. The only shared
 * state across the 7a/7b seam is this table + the mma_batch/SSE plumbing.
 *
 * Invariants encoded here (load-bearing — see Spec 7 §Data model):
 *  - `title` is the VERBATIM ATX heading text used as the execute-plan
 *    taskDescriptor (heading sans the leading `#`s); the MMA matcher compares
 *    `heading.trim() === descriptor.trim()`, so `title` round-trips byte-for-byte.
 *  - `is_write` is always true (a read-only repo gets NO plan_task; the write/read
 *    split is computed at the repo level for display).
 *  - `commit_sha` holds the MMA WORKER commit SHA (read from the envelope's
 *    `structuredReport.commitSha`). The optional Forge inline-fix commit SHA goes
 *    in `meta.fixCommitSha`, never here — so the MMA-vs-fix distinction survives.
 *  - `meta` shape: `{ buildCmd?, testCmd?, fixCommitSha? }` (display/audit only).
 */
export const planTask = forge.table(
  'project_plan_task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(), // verbatim ATX heading text = the taskDescriptor
    detail: text('detail'), // optional UI summary
    phase: text('phase'), // track/phase grouping (e.g. "Track G — Guard fixes")
    targetRepoId: uuid('target_repo_id')
      .notNull()
      .references(() => repo.id), // the ONE repo (one-repo-per-task)
    isWrite: boolean('is_write').notNull().default(true),
    dependsOn: uuid('depends_on').array(), // other plan_task.id[]
    orderIndex: integer('order_index').notNull(),
    reviewPolicy: text('review_policy', { enum: REVIEW_POLICY }).notNull().default('reviewed'),
    status: text('status', { enum: BUILD_TASK_STATUS }).notNull().default('queued'),
    branch: text('branch'), // the prepared per-run branch forge/<run>/<repo>
    targetBranch: text('target_branch'), // user-selected base branch for build + PR target
    commitSha: text('commit_sha'), // the MMA worker commit SHA (envelope.structuredReport.commitSha)
    fixNote: text('fix_note'), // the main-agent inline fix description, if any
    approvedBy: jsonb('approved_by_list').notNull().default([]), // member id[] who approved this task
    participants: jsonb('participants').notNull().default([]), // member id[] invited to review
    meta: jsonb('meta'), // { buildCmd?, testCmd?, fixCommitSha? } — display/audit only
    mmaBatchId: uuid('mma_batch_id').references(() => mmaBatch.id), // the execute_plan call
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('plan_task_project_order_idx').on(t.projectId, t.orderIndex),
    index('plan_task_repo_idx').on(t.targetRepoId),
    index('plan_task_status_idx').on(t.status),
  ],
);

export type PlanTaskRow = typeof planTask.$inferSelect;

/** The shape of `plan_task.meta` (display/audit only — no key is read by logic). */
export interface PlanTaskMeta {
  buildCmd?: string | null;
  testCmd?: string | null;
  fixCommitSha?: string;
}

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
    artifactId: uuid('artifact_id'), // null for a bundle; no FK cascade needed (additive)
    format: text('format', { enum: ['md', 'pdf', 'bundle'] }).notNull(),
    filePath: text('file_path').notNull(), // md: synthetic served filename `<kind>-v<version>.md`
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('export_project_idx').on(t.projectId, t.createdAt.desc())],
);

export type ExportRow = typeof exportRecord.$inferSelect;
