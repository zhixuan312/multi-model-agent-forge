/**
 * In-code enum modules — the canonical value source for fixed-value-set columns.
 *
 * Enums live in code, never in Postgres (no `pgEnum`). Columns reference these
 * arrays via Drizzle `text({ enum: X })`; Zod schemas derive via `z.enum(X)`.
 * Adding/removing a value is a code change, not an `ALTER TYPE` migration.
 */

/** repo.status value set (schema.md §2). Workspace clone/pull lifecycle. */
export const REPO_STATUS = ['cloned', 'pulling', 'error'] as const;

/* ── Spec 3: Projects ───────────────────────────────────────────────────── */

/** project.visibility (schema.md §3). private = artifact-gated; public = all members. */
export const PROJECT_VISIBILITY = ['private', 'public'] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITY)[number];

/** project.phase (schema.md §3). design→build→learn. Matches stepper groups. */
export const PROJECT_PHASE = ['design', 'build', 'learn', 'completed'] as const;
export type ProjectPhase = (typeof PROJECT_PHASE)[number];

/**
 * stage.kind (schema.md §5). The fixed six-stage skeleton seeded on create,
 * grouped DESIGN (exploration·spec·plan) › BUILD (execute·review) › LEARN (journal).
 * `STAGE_ORDER` is the canonical seed + render order (drives seeding + stepper).
 */
export const STAGE_KIND = ['exploration', 'spec', 'plan', 'execute', 'review', 'journal'] as const;
export type StageKind = (typeof STAGE_KIND)[number];

/** The fixed seed + render order — same tuple as STAGE_KIND, named for intent. */
export const STAGE_ORDER = STAGE_KIND;

/** stage.status (schema.md §5). pending→active→done. */
export const STAGE_STATUS = ['pending', 'active', 'done'] as const;
export type StageStatus = (typeof STAGE_STATUS)[number];

/* ── Spec 4: Spec stage ─────────────────────────────────────────────────── */

/**
 * component.kind (schema.md §5). The fixed set of spec components, driven by
 * `COMPONENT_TEMPLATES`. `nfr`/`assumptions` are the two ☐-by-default components.
 */
export const COMPONENT_KIND = [
  'context',
  'problem',
  'goals_requirements',
  'alternatives',
  'technical_design',
  'testing_plan',
  'risks',
  'stories_tasks',
] as const;
export type ComponentKind = (typeof COMPONENT_KIND)[number];

/**
 * component / component_section status (schema.md §5). A 4-state machine reused
 * at BOTH levels. Section: gathering→satisfied→drafted→approved. Component status
 * is the roll-up (all approved ⇒ approved; else the lowest). The ordinal order of
 * this tuple is the `<` ordering used by the roll-up (`gathering < … < approved`).
 */
export const COMPONENT_STATUS = ['gathering', 'drafted', 'approved'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUS)[number];

/**
 * artifact.kind (schema.md §6). `exploration` kind exists in DB for legacy rows
 * but new exploration summaries are file-based (.mma/projects/<id>/exploration.md).
 * Active DB writes: `exploration_brief` (brain-dump), `spec`, `plan`.
 */
export const ARTIFACT_KIND = ['exploration_brief', 'exploration', 'spec', 'plan'] as const;
export type ArtifactKind = (typeof ARTIFACT_KIND)[number];

/** audit_pass.verdict (schema.md §8). `revised` = had critical/high; `clean` = none. */
export const AUDIT_VERDICT = ['revised', 'clean'] as const;
export type AuditVerdict = (typeof AUDIT_VERDICT)[number];

/* ── Spec 5: Exploration ────────────────────────────────────────────────── */

/**
 * attachment.kind (schema.md §4). A brief INPUT (material that feeds a task, not
 * an MMA route): a validated link, an uploaded image, or an uploaded file.
 */
export const ATTACHMENT_KIND = ['link', 'image', 'file'] as const;

/**
 * mma_route (schema.md §7). The route an `mma_batch` was dispatched on. This
 * spec emits only the first three; the full set is declared now so Spec 7 adds
 * rows, not a migration. Note the underscore: `journal_recall` (the HTTP segment
 * is `journal-recall`, the task kind is `journal`).
 */
export const MMA_ROUTE = [
  'investigate',
  'research',
  'journal_recall',
  'audit',
  'execute_plan',
  'review',
  'journal_record',
  'delegate',
  'orchestrate', // orchestrator brain — used by Loops' plan + journal stages
] as const;
export type MmaRoute = (typeof MMA_ROUTE)[number];

/** mma_batch.status (schema.md §7). dispatched → running → done|failed. */
export const MMA_STATUS = ['dispatched', 'running', 'done', 'failed'] as const;

/* ── Spec 7: Build pipeline ─────────────────────────────────────────────── */

/**
 * export.format (schema.md §6 / Spec 7) — `md` is the only path exercised in
 * Spec 7 (the per-stage raw-markdown download). `pdf`/`bundle` are reserved for
 * Spec 8's export subsystem (inert here).
 */
export const EXPORT_FORMAT = ['md', 'pdf', 'bundle'] as const;
export type ExportFormat = (typeof EXPORT_FORMAT)[number];

/* ── Loops (admin-only, cron-scheduled goal-driven jobs) ────────────────────── */

/**
 * loop.kind — the activity type. Kind #1 = `maintenance` (pursue a free-text
 * quality goal). New kinds are added here + in the LOOP_KINDS registry; the
 * per-kind config lives in `loop.config` (jsonb), so a new kind is a code change,
 * not a migration.
 */
export const LOOP_KIND = ['maintenance'] as const;
export type LoopKind = (typeof LOOP_KIND)[number];

/** loop.worker_tier — which MMA worker the loop dispatches (maps to agentType). `main` is the orchestrator, never a worker. */
export const LOOP_WORKER_TIER = ['standard', 'complex'] as const;

/** loop_run.trigger — how a fire was activated. */
export const LOOP_TRIGGER = ['schedule', 'manual'] as const;
export type LoopTrigger = (typeof LOOP_TRIGGER)[number];

/** loop_run.status — per-repo outcome of a fire. A failed run never opens a PR. */
export const LOOP_RUN_STATUS = ['running', 'changed', 'no_changes', 'failed'] as const;
