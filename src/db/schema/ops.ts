import { uuid, text, jsonb, timestamp, index, integer, numeric, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { MMA_ROUTE, MMA_STATUS } from '@/db/enums';

/**
 * `ops_mma_batch` — one row per MMA call. The scalar `target_repo_id` FK
 * structurally bounds each batch to ≤1 repo. `result` holds the terminal
 * 7-field envelope only after a terminal state.
 */
export const mmaBatch = forge.table(
  'ops_mma_batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    route: text('route', { enum: MMA_ROUTE }).notNull(),
    targetRepoId: uuid('target_repo_id').references(() => repo.id),
    cwd: text('cwd').notNull(),
    batchId: text('batch_id'),
    status: text('status', { enum: MMA_STATUS }).notNull().default('dispatched'),
    handler: text('handler'),
    request: jsonb('request').notNull(),
    result: jsonb('result'),
    dispatchedBy: uuid('dispatched_by').references(() => member.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    costUsd: numeric('cost_usd'),
    savedVsMainUsd: numeric('saved_vs_main_usd'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    implementerModel: text('implementer_model'),
    reviewerModel: text('reviewer_model'),
    implementerTier: text('implementer_tier'),
    loopRunId: uuid('loop_run_id'),
  },
  (t) => [
    index('mma_batch_project_created_idx').on(t.projectId, t.createdAt),
    index('mma_batch_batch_id_idx').on(t.batchId),
    index('mma_batch_loop_run_idx').on(t.loopRunId),
  ],
);

export type MmaBatchRow = typeof mmaBatch.$inferSelect;

/**
 * `ops_action_log` — the domain accountability trail. One row per state-changing
 * user action (mutations and dispatches only — page navigation and read-only
 * actions are NOT logged). Failure policy: log write failure degrades gracefully
 * (log the error, do NOT abort the user's mutation).
 */
export const actionLog = forge.table(
  'ops_action_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => project.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => member.id),
    action: text('action').notNull(),
    target: text('target'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('action_log_project_created_idx').on(t.projectId, t.createdAt.desc())],
);

export type ActionLogRow = typeof actionLog.$inferSelect;

/**
 * `ops_notification` — user-facing alerts. Currently two kinds:
 * `dispatch_failed` (MMA batch failed) and `section_invite` (invited to review).
 */
export const notification = forge.table(
  'ops_notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id').references(() => member.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    sourceId: text('source_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notification_member_feed_idx').on(t.memberId, t.dismissedAt, t.createdAt),
    uniqueIndex('notification_source_dedup_idx').on(t.sourceId).where(sql`${t.sourceId} IS NOT NULL`),
  ],
);

export type NotificationRow = typeof notification.$inferSelect;

/**
 * `ops_auto_step` — one row per automation action. The driver inserts a row
 * BEFORE executing each action (status 'running') and updates it to 'done' or
 * 'failed' after. The resolver checks this table to prevent re-dispatching
 * completed actions. The overlay reads it for stats (step count, elapsed time).
 */
export const autoStep = forge.table(
  'ops_auto_step',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }).notNull(),
    action: text('action').notNull(),
    note: text('note').notNull(),
    stage: text('stage'),
    phase: text('phase'),
    targetId: text('target_id'),
    status: text('status', { enum: ['running', 'done', 'failed'] as const }).notNull().default('running'),
    error: text('error'),
    mmaBatchId: uuid('mma_batch_id'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
  },
  (t) => [
    index('auto_step_project_created_idx').on(t.projectId, t.createdAt),
    index('auto_step_project_action_target_idx').on(t.projectId, t.action, t.targetId),
  ],
);

export type AutoStepRow = typeof autoStep.$inferSelect;
