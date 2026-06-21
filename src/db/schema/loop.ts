import { uuid, text, jsonb, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { repo } from '@/db/schema/workspace';
import { mmaBatch } from '@/db/schema/mma';
import { LOOP_KIND, LOOP_WORKER_TIER, LOOP_TRIGGER, LOOP_RUN_STATUS } from '@/db/enums';

/**
 * `loop_def` — an admin-only, cron-scheduled, goal-driven job (see
 * docs/superpowers/specs/2026-06-15-loops-design.md). The config is a "cron job +
 * a goal": it targets a set of workspace repos (`repo_ids` uuid[], no join table —
 * repo membership is edited atomically with the config and only read whole at fire
 * time), runs a per-kind activity, and opens a PR for review (never auto-merges).
 *
 * Kind-extensible: `kind` + `config` (jsonb, per-kind Zod-validated via the
 * LOOP_KINDS registry). Kind #1 `maintenance` config = `{ goalMd }`. A new kind is
 * a registry entry + config shape — no schema change.
 */
export const loop = forge.table(
  'loop_def',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(), // required, trimmed, unique-per-workspace (enforced in service)
    kind: text('kind', { enum: LOOP_KIND }).notNull(),
    config: jsonb('config').notNull(), // per-kind; maintenance → { goalMd }
    workerTier: text('worker_tier', { enum: LOOP_WORKER_TIER }).notNull().default('complex'),
    cron: text('cron'), // standard cron, e.g. "0 3 * * *"; NULL = one-time (adhoc, scheduler skips it)
    targetBranch: text('target_branch'), // base branch to fork from + PR into; NULL = repo default branch
    repoIds: uuid('repo_ids').array().notNull().default(sql`'{}'`), // → repo.id (validated in service)
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => member.id), // admin owner; null = system
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('loop_enabled_idx').on(t.enabled)],
);

/**
 * `loop_run` — one row per (repo, fire). `run_id` correlates the repos fired
 * together (the history "run" unit). Points at the `ops_mma_batch` that did the work
 * (the same pattern as `project_plan_task` / `project_exploration_task`). `pr_url` is non-null only
 * when `status='changed'`; a failed run never opens a PR. `key_changes` /
 * `journal_entries` are the point-form snapshots the history screen renders.
 */
export const loopRun = forge.table(
  'loop_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    loopId: uuid('loop_id')
      .notNull()
      .references(() => loop.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(), // groups one fire across its repos
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repo.id),
    trigger: text('trigger', { enum: LOOP_TRIGGER }).notNull(),
    status: text('status', { enum: LOOP_RUN_STATUS }).notNull().default('running'),
    branch: text('branch'), // loop/<slug>/<date>; null until created
    prUrl: text('pr_url'), // non-null only when status='changed'
    mmaBatchId: uuid('mma_batch_id').references(() => mmaBatch.id), // the dispatch that did the work
    keyChanges: jsonb('key_changes'), // string[] — point-form CHANGE summary (changes only; not metadata)
    verification: jsonb('verification'), // { command, passed, detail } | null — its own slot, not a "change"
    filesChanged: jsonb('files_changed'), // string[] | null — touched files, structured (not a "N files" string)
    journalEntries: jsonb('journal_entries'), // { tag: 'learned'|'missed'|'avoided', text }[]
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('loop_run_loop_started_idx').on(t.loopId, t.startedAt),
    index('loop_run_run_id_idx').on(t.runId),
  ],
);

export type LoopRow = typeof loop.$inferSelect;
export type LoopRunRow = typeof loopRun.$inferSelect;

/** Structured verification slot on a run (was previously a `keyChanges` string). */
export interface RunVerification {
  command: string | null; // null = not configured
  passed: boolean | null; // null when not configured
  detail: string;
}
