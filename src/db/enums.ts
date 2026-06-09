/**
 * In-code enum modules — the canonical value source for fixed-value-set columns.
 *
 * Enums live in code, never in Postgres (no `pgEnum`). Columns reference these
 * arrays via Drizzle `text({ enum: X })`; Zod schemas derive via `z.enum(X)`.
 * Adding/removing a value is a code change, not an `ALTER TYPE` migration.
 *
 * Spec 1 only needs `auth_provider` (the other sets in schema.md §1 belong to
 * later-spec tables and are added when those tables land — YAGNI).
 */

export const AUTH_PROVIDER = ['local'] as const; // ldap|oidc|saml|supabase added with their strategies later
export type AuthProvider = (typeof AUTH_PROVIDER)[number];

/**
 * Provider API dialect (schema.md §1 `provider_type`). The two on-the-wire
 * dialects MMA's config layer discriminates: `claude` (Anthropic-style) and
 * `codex` (OpenAI-style / Codex). OpenAI-compatible providers are `codex`.
 */
export const PROVIDER_TYPE = ['claude', 'codex'] as const;
export type ProviderType = (typeof PROVIDER_TYPE)[number];

/**
 * Agent tiers (schema.md §1 `agent_tier`). `main` = Forge's orchestrator model
 * (sent as X-MMA-Main-Model, NOT an MMA worker tier); `complex`/`standard` =
 * MMA's two worker tiers → config.agents.{complex,standard}. Exactly 3 rows.
 */
export const AGENT_TIER = ['main', 'complex', 'standard'] as const;
export type AgentTier = (typeof AGENT_TIER)[number];

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
 * stage.kind (schema.md §5). The fixed five-stage skeleton seeded on create.
 * `STAGE_ORDER` is the canonical seed + render order (drives seeding + stepper).
 */
export const STAGE_KIND = ['exploration', 'spec', 'plan', 'execute', 'review'] as const;
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
  'tech_design',
  'test_plan',
  'stories_tasks',
  'nfr',
  'assumptions',
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
