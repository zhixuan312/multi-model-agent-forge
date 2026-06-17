import { uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';
import { repo } from '@/db/schema/workspace';
import { MMA_ROUTE, MMA_STATUS } from '@/db/enums';

/**
 * `ops_mma_batch` (schema.md §7 / Spec 5) — one row per MMA call. The scalar
 * `target_repo_id` FK structurally bounds each batch to ≤1 repo (the one-repo
 * invariant's structural half; the conditional half — which routes carry a repo
 * — lives in the Zod input layer). `cwd` is `notNull` for EVERY route (research
 * and journal-recall carry the workspace root even though they have no
 * specific-repo target). `result` holds the terminal 7-field envelope only after
 * a terminal state; live poll progress is streamed, never persisted.
 *
 * `dispatched_by` is nullable by design: a member-triggered dispatch stamps the
 * actor; a system-resumed (rehydrated) dispatch is actor-less.
 */
export const mmaBatch = forge.table(
  'ops_mma_batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }), // nullable: loop dispatches are team-level (not project-scoped); SDLC dispatches still set it
    route: text('route', { enum: MMA_ROUTE }).notNull(),
    targetRepoId: uuid('target_repo_id').references(() => repo.id), // the ONE repo; null for research/journal-recall
    cwd: text('cwd').notNull(), // the dispatched ?cwd= — REQUIRED for EVERY route
    batchId: text('batch_id'), // MMA's returned batchId (for polling)
    status: text('status', { enum: MMA_STATUS }).notNull().default('dispatched'),
    request: jsonb('request').notNull(), // the POST body
    result: jsonb('result'), // terminal 7-field envelope
    dispatchedBy: uuid('dispatched_by').references(() => member.id), // nullable: actor-less resumed dispatch
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
  },
  (t) => [
    index('mma_batch_project_created_idx').on(t.projectId, t.createdAt),
    index('mma_batch_batch_id_idx').on(t.batchId),
  ],
);

export type MmaBatchRow = typeof mmaBatch.$inferSelect;
