import { uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';
import {
  AUDIT_SCOPE,
  AUDIT_VERDICT,
} from '@/db/enums';

/**
 * Audit + learning tables. The `project_artifact` table has been eliminated —
 * all artifact content is file-based at `.mma/projects/<id>/*.md`.
 */

/**
 * `project_audit_pass` (schema.md §8) — one row per audit pass (Spec 4 Part B). `pass_no`
 * is the MONOTONIC persisted counter (`max(pass_no)+1` per pass; MAY exceed
 * `AUDIT_PASS_CAP` across user re-runs). `mma_batch_id` is nullable with NO FK —
 * the `ops_mma_batch` table lands with Spec 5; Spec 4 persists only the audit outcome
 * (Data-model open-question default (a)).
 */
export const auditPass = forge.table(
  'project_audit_pass',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: AUDIT_SCOPE }).notNull(),
    passNo: integer('pass_no').notNull(),
    findingsCount: integer('findings_count').notNull(),
    verdict: text('verdict', { enum: AUDIT_VERDICT }).notNull(),
    mmaBatchId: uuid('mma_batch_id'),
    contextBlockId: text('context_block_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_pass_project_idx').on(t.projectId, t.passNo)],
);

export type AuditPassRow = typeof auditPass.$inferSelect;
