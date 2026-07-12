import { uuid, text, jsonb, timestamp, index, integer, numeric, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { team } from '@/db/schema/team';
import { MMA_ROUTE, MMA_STATUS } from '@/db/enums';

export const mmaBatch = forge.table(
  'ops_mma_batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').notNull().references(() => team.id),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    route: text('route', { enum: MMA_ROUTE }).notNull(),
    targetRepoId: uuid('target_repo_id').references(() => repo.id),
    cwd: text('cwd').notNull(),
    batchId: text('batch_id'),
    status: text('status', { enum: MMA_STATUS }).notNull().default('dispatched'),
    handler: text('handler'),
    request: jsonb('request').notNull(),
    result: jsonb('result'),
    dispatchedBy: uuid('dispatched_by').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    costUsd: numeric('cost_usd'),
    savedVsMainUsd: numeric('saved_vs_main_usd'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheTokens: integer('cache_tokens'),
    durationMs: integer('duration_ms'),
    loopRunId: uuid('loop_run_id'),
  },
  (t) => [index('mma_batch_team_created_idx').on(t.teamId, t.createdAt), index('mma_batch_project_created_idx').on(t.projectId, t.createdAt), index('mma_batch_batch_id_idx').on(t.batchId), index('mma_batch_loop_run_idx').on(t.loopRunId)],
);

export type MmaBatchRow = typeof mmaBatch.$inferSelect;

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
