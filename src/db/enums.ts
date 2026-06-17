/**
 * In-code enum modules — the canonical value source for fixed-value-set columns.
 *
 * Enums live in code, never in Postgres (no `pgEnum`). Columns reference these
 * arrays via Drizzle `text({ enum: X })`; Zod schemas derive via `z.enum(X)`.
 * Adding/removing a value is a code change, not an `ALTER TYPE` migration.
 */

/** repo.status value set (schema.md §2). Workspace clone/pull lifecycle. */
export const REPO_STATUS = ['cloned', 'pulling', 'error'] as const;
export type RepoStatus = (typeof REPO_STATUS)[number];

/* ── Spec 3: Projects ───────────────────────────────────────────────────── */

/** project.visibility (schema.md §3). private = artifact-gated; public = all members. */
export const PROJECT_VISIBILITY = ['private', 'public'] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITY)[number];

/** project.phase (schema.md §3). design→frozen→build→done. Spec 3 only seeds `design`. */
export const PROJECT_PHASE = ['design', 'frozen', 'build', 'done'] as const;
export type ProjectPhase = (typeof PROJECT_PHASE)[number];

/** project_member.role (schema.md §3). owner seeded on create; collaborator added later. */
export const PROJECT_MEMBER_ROLE = ['owner', 'collaborator'] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLE)[number];

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
  'context_scope',
  'problem_motivation',
  'goals_nongoals',
  'requirements',
  'proposed_design',
  'interfaces_apis',
  'data_storage',
  'alternatives',
  'decision_status',
  'cross_cutting',
  'risks_consequences',
  'test_validation',
  'rollout_migration',
  'work_breakdown',
  'success_metrics',
] as const;
export type ComponentKind = (typeof COMPONENT_KIND)[number];

/**
 * component / component_section status (schema.md §5). A 4-state machine reused
 * at BOTH levels. Section: gathering→satisfied→drafted→approved. Component status
 * is the roll-up (all approved ⇒ approved; else the lowest). The ordinal order of
 * this tuple is the `<` ordering used by the roll-up (`gathering < … < approved`).
 */
export const COMPONENT_STATUS = ['gathering', 'satisfied', 'drafted', 'approved'] as const;
export type ComponentStatus = (typeof COMPONENT_STATUS)[number];

/** qa_message.sender (schema.md §5). `forge` = the AI interviewer; `member` = a human. */
export const QA_SENDER = ['forge', 'member'] as const;
export type QaSender = (typeof QA_SENDER)[number];

/**
 * artifact.kind (schema.md §6). Spec 4 only WRITES `spec`; READS `exploration`
 * (Spec 5 writes it). `exploration_brief`/`plan` are carried for later specs so
 * those can write without a migration.
 */
export const ARTIFACT_KIND = ['exploration_brief', 'exploration', 'spec', 'plan'] as const;
export type ArtifactKind = (typeof ARTIFACT_KIND)[number];

/** audit_pass.scope (schema.md §8). Spec 4 only writes `spec` (Part B); `plan` is Spec 7. */
export const AUDIT_SCOPE = ['spec', 'plan'] as const;
export type AuditScope = (typeof AUDIT_SCOPE)[number];

/** audit_pass.verdict (schema.md §8). `revised` = had critical/high; `clean` = none. */
export const AUDIT_VERDICT = ['revised', 'clean'] as const;
export type AuditVerdict = (typeof AUDIT_VERDICT)[number];

/** learning_candidate.type (schema.md §9). The kind of learning proposed at freeze. */
export const LEARNING_TYPE = ['challenge', 'insight', 'decision'] as const;
export type LearningType = (typeof LEARNING_TYPE)[number];

/** learning_candidate.origin (schema.md §9). Which stage produced the learning. */
export const LEARNING_ORIGIN = ['exploration', 'spec'] as const;
export type LearningOrigin = (typeof LEARNING_ORIGIN)[number];

/** learning_candidate.status (schema.md §9). proposed→kept/removed→recorded. */
export const LEARNING_STATUS = ['proposed', 'kept', 'removed', 'recorded'] as const;
export type LearningStatus = (typeof LEARNING_STATUS)[number];

/** Ordinal rank for COMPONENT_STATUS — the `<` ordering used by the component roll-up. */
export function componentStatusRank(status: ComponentStatus): number {
  return COMPONENT_STATUS.indexOf(status);
}

/* ── Spec 5: Exploration ────────────────────────────────────────────────── */

/**
 * attachment.kind (schema.md §4). A brief INPUT (material that feeds a task, not
 * an MMA route): a validated link, an uploaded image, or an uploaded file.
 */
export const ATTACHMENT_KIND = ['link', 'image', 'file'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KIND)[number];

/**
 * exploration_task.kind (schema.md §4). The MMA read rod a fan-out task runs:
 * `investigate` (one repo), `research` (external), `journal` → mma-journal-recall.
 */
export const EXPLORATION_TASK_KIND = ['investigate', 'research', 'journal'] as const;
export type ExplorationTaskKind = (typeof EXPLORATION_TASK_KIND)[number];

/**
 * exploration_task.status (schema.md §4). draft (proposed/editable) → running
 * (dispatched) → recorded (terminal, LOCKED). There is NO `failed` value — a
 * failed task still ends at `recorded`; per-task success/failure is derived from
 * the joined `mma_batch.status`.
 */
export const EXPLORATION_TASK_STATUS = ['draft', 'running', 'recorded'] as const;
export type ExplorationTaskStatus = (typeof EXPLORATION_TASK_STATUS)[number];

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
  'delegate', // ad-hoc implementation dispatch — used by Loops' maintenance work step
] as const;
export type MmaRoute = (typeof MMA_ROUTE)[number];

/** mma_batch.status (schema.md §7). dispatched → running → done|failed. */
export const MMA_STATUS = ['dispatched', 'running', 'done', 'failed'] as const;
export type MmaStatus = (typeof MMA_STATUS)[number];

/* ── Spec 7: Build pipeline ─────────────────────────────────────────────── */

/**
 * plan_task.status (schema.md §8 / Spec 7). The per-task execute lane state
 * machine: queued→executing→verifying→[fixing]→committed, or skipped / failed.
 * The 7a/7b seam is `queued` (7a fills queued rows; 7b consumes them).
 */
export const BUILD_TASK_STATUS = [
  'queued',
  'executing',
  'verifying',
  'fixing',
  'committed',
  'skipped',
  'failed',
] as const;
export type BuildTaskStatus = (typeof BUILD_TASK_STATUS)[number];

/**
 * plan_task.review_policy (schema.md §0 / Spec 7) — mirrors MMA's
 * `perTaskReviewPolicy` value set VERBATIM (verified against MMA
 * `tools/execute-plan/tool-config.ts`: `z.enum(['full','quality_only',
 * 'diff_only','none'])`). Authoring sets `none` only for tasks the plan marks
 * "downstream errors expected, fixed by a later task"; default is `full`.
 */
export const REVIEW_POLICY = ['full', 'quality_only', 'diff_only', 'none'] as const;
export type ReviewPolicy = (typeof REVIEW_POLICY)[number];

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
export type LoopWorkerTier = (typeof LOOP_WORKER_TIER)[number];

/** loop_run.trigger — how a fire was activated. */
export const LOOP_TRIGGER = ['schedule', 'manual'] as const;
export type LoopTrigger = (typeof LOOP_TRIGGER)[number];

/** loop_run.status — per-repo outcome of a fire. A failed run never opens a PR. */
export const LOOP_RUN_STATUS = ['running', 'changed', 'no_changes', 'failed'] as const;
export type LoopRunStatus = (typeof LOOP_RUN_STATUS)[number];
