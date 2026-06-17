import { uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { forge } from '@/db/schema/_schema';
import { member } from '@/db/schema/identity';
import { project } from '@/db/schema/projects';
import {
  ARTIFACT_KIND,
  AUDIT_SCOPE,
  AUDIT_VERDICT,
  LEARNING_TYPE,
  LEARNING_ORIGIN,
  LEARNING_STATUS,
} from '@/db/enums';

/**
 * Artifact + audit + learning tables (schema.md §6/§8/§9 / Spec 4). These land in
 * one migration with the spec-authoring tables; their consuming CODE splits 4a
 * (assemble → `artifact(kind='spec')`) vs 4b (audit loop + learnings). The DB is
 * additive, so all six tables ship together.
 */

/**
 * `project_artifact` (schema.md §6) — a versioned stage output. Spec 4 INSERTs
 * `kind='spec'` (bumping `version` on re-assemble) and READs `kind='exploration'`
 * (Spec 5 writes it). `created_by` NULL = agent-generated. Component drafts live
 * on `component_section.draft_md`, NOT here.
 */
export const artifact = forge.table(
  'project_artifact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ARTIFACT_KIND }).notNull(),
    bodyMd: text('body_md').notNull(),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => member.id), // NULL = agent-generated
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('artifact_project_kind_version_idx').on(t.projectId, t.kind, t.version.desc())],
);

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
    mmaBatchId: uuid('mma_batch_id'), // nullable; no FK (mma_batch is Spec 5)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_pass_project_idx').on(t.projectId, t.passNo)],
);

/**
 * `project_learning_candidate` (schema.md §9) — the at-freeze curation set (staging only,
 * NOT the journal). proposed→kept/removed→recorded. `recorded_node_id` is the MMA
 * journal node id (verbatim, e.g. `0007-some-slug`) after a journal-record write.
 */
export const learningCandidate = forge.table(
  'project_learning_candidate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    type: text('type', { enum: LEARNING_TYPE }).notNull(),
    origin: text('origin', { enum: LEARNING_ORIGIN }).notNull(),
    status: text('status', { enum: LEARNING_STATUS }).notNull().default('proposed'),
    recordedNodeId: text('recorded_node_id'), // MMA journal node id after write
    createdBy: uuid('created_by').references(() => member.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('learning_candidate_project_idx').on(t.projectId)],
);

export type ArtifactRow = typeof artifact.$inferSelect;
export type AuditPassRow = typeof auditPass.$inferSelect;
export type LearningCandidateRow = typeof learningCandidate.$inferSelect;
