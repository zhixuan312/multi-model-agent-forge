import { uuid, text, jsonb, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { repo } from '@/db/schema/workspace';
import { mmaBatch } from '@/db/schema/ops';
import { team } from '@/db/schema/team';
import { LOOP_KIND, LOOP_WORKER_TIER, LOOP_TRIGGER, LOOP_RUN_STATUS } from '@/db/enums';

export const loop = forge.table(
  'loop_def',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').notNull().references(() => team.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: LOOP_KIND }).notNull(),
    config: jsonb('config').notNull(),
    workerTier: text('worker_tier', { enum: LOOP_WORKER_TIER }).notNull().default('complex'),
    cron: text('cron'),
    targetBranch: text('target_branch'),
    repoIds: uuid('repo_ids').array().notNull().default(sql`'{}'`),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('loop_team_idx').on(t.teamId), index('loop_enabled_idx').on(t.enabled)],
);

export const loopRun = forge.table(
  'loop_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').notNull().references(() => team.id),
    loopId: uuid('loop_id').notNull().references(() => loop.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    repoId: uuid('repo_id').notNull().references(() => repo.id),
    trigger: text('trigger', { enum: LOOP_TRIGGER }).notNull(),
    status: text('status', { enum: LOOP_RUN_STATUS }).notNull().default('running'),
    branch: text('branch'),
    prUrl: text('pr_url'),
    mmaBatchId: uuid('mma_batch_id').references(() => mmaBatch.id),
    keyChanges: jsonb('key_changes'),
    verification: jsonb('verification'),
    filesChanged: jsonb('files_changed'),
    journalEntries: jsonb('journal_entries'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('loop_run_team_started_idx').on(t.teamId, t.startedAt), index('loop_run_loop_started_idx').on(t.loopId, t.startedAt), index('loop_run_run_id_idx').on(t.runId)],
);

export type LoopRow = typeof loop.$inferSelect;
export type LoopRunRow = typeof loopRun.$inferSelect;
export interface RunVerification { command: string | null; passed: boolean | null; detail: string; }
