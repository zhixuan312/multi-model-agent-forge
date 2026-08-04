/**
 * In-code enum modules — the canonical value source for every fixed value set.
 *
 * Enums live in code, never in Postgres (no `pgEnum`). Columns reference these
 * arrays via Drizzle `text({ enum: X })`; Zod schemas derive via `z.enum(X)`.
 * Adding/removing a value is a code change, not an `ALTER TYPE` migration.
 *
 * COLUMNS were the original scope, and that was too narrow to be useful. The value sets
 * inside the `details` JSONB document are fixed in exactly the same way, and
 * `tests/db/enum-single-source.test.ts` — the only thing that finds a re-spelling — reads
 * this file and nothing else. Three separate duplications survived purely because their set
 * was declared somewhere the checker does not look (`project_activity.kind`,
 * `DISCOVER_TASK_KIND`, `LEARNING_CATEGORIES`). A fixed value set belongs here whether a
 * column, a JSONB field, or a wire field carries it.
 */

/** repo.status value set (schema.md §2). Workspace clone/pull lifecycle. */
export const REPO_STATUS = ['cloned', 'pulling', 'error'] as const;
export type RepoStatus = (typeof REPO_STATUS)[number];

export const TEAM_ROLE = ['org_admin', 'team_admin', 'member'] as const;
export type TeamRole = (typeof TEAM_ROLE)[number];

/**
 * "Counts as an admin" — either admin role.
 *
 * Lives beside the enum so every layer can reach it: the page gate, the sidebar's
 * adminOnly filter and the members core each spelled the pair out, and members-core's
 * copy also accepted a legacy `isAdmin` boolean for a column the schema no longer has.
 * A third admin role would have had to be remembered in three places.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'org_admin' || role === 'team_admin';
}

/**
 * `project_qa_message.target_kind` — which row a discussion thread hangs off.
 *
 * The column was plain `text()` with no vocabulary anywhere, and the two literals were
 * spelled out in nine files. The SSE `chat.message` scope union additionally carried a
 * THIRD value, `spec_project`, which no code path ever wrote and no client ever branched
 * on — a scope the type system permitted and the product never produced. Declared here with
 * the other column vocabularies so the column, the wire scope and the writers share one
 * definition.
 */
export const QA_TARGET_KIND = ['spec_component', 'plan_task'] as const;
export type QaTargetKind = (typeof QA_TARGET_KIND)[number];

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

/** stage.status (schema.md §5). pending→active→done/skipped. */
export const STAGE_STATUS = ['pending', 'active', 'done', 'skipped'] as const;
export type StageStatus = (typeof STAGE_STATUS)[number];

/* ── Spec 4: Spec stage ─────────────────────────────────────────────────── */

/**
 * component.kind (schema.md §5). The fixed set of spec components, driven by
 * `COMPONENT_TEMPLATES` — where all eight are `default: true`, so the Outline picker
 * starts with every box ticked. (It used to name two unticked-by-default components,
 * "nfr" and "assumptions", that exist nowhere in the codebase. In this file a backticked
 * lowercase word means a real value — see tests/db/enum-doc-accuracy.)
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
 * component status. THREE states, in ascending order: a component is `approved` once it
 * has an approval, `drafted` once spec.md holds real content for it, else `gathering`
 * (see `loadOutline`). The tuple's order is that ranking.
 *
 * The doc here described a four-state machine — gathering, "satisfied", drafted,
 * approved — applied at both component and SECTION level with a lowest-wins roll-up.
 * No "satisfied" state exists, there is no per-section status, and nothing rolls up.
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

/**
 * mma_route (schema.md §7). The route an `mma_batch` was dispatched on. Note the
 * underscore: `journal_recall` (the HTTP segment is `journal-recall`, the task kind is
 * `journal`). Adding a route is a code change here, never a migration.
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
  'orchestrate',
  'spec',
  'plan',
] as const;
export type MmaRoute = (typeof MMA_ROUTE)[number];

/**
 * mma_batch.status (schema.md §7). dispatched → running → done|failed|cancelled.
 *
 * `cancelled` (engine 5.16) is a DELIBERATE stop requested via `DELETE /task/:id` —
 * terminal but NOT a fault, so automation must never re-dispatch it (see
 * `reconcileStuckAttempts`). The engine's other new terminal state, `interrupted`
 * (daemon restarted, `retryable: true`), intentionally lands here as `failed`:
 * resubmitting is the correct response, so it shares the retry path.
 */
export const MMA_STATUS = ['dispatched', 'running', 'done', 'failed', 'cancelled'] as const;
export type MmaStatus = (typeof MMA_STATUS)[number];

/**
 * The two states a batch is still WORKING in. Everything else is finished.
 *
 * Declared as the in-flight set and the terminal set DERIVED from it, rather than the other
 * way round, because that is the direction that fails safe: a status added to `MMA_STATUS`
 * becomes terminal automatically, and has to be named here to be treated as in-flight.
 *
 * The alternative is what was there — `['dispatched', 'running']` written out six times and
 * `['done', 'failed']` written out EIGHT times — and the eight were wrong. Engine 5.16 added
 * `cancelled`, which `dispatch-helpers` persists together with the batch's `costUsd`,
 * tokens and duration, and every query on the Usage page filtered it out. The cost dashboard
 * under-reported real spend by the whole cost of every cancelled run, silently, because a
 * subset like that is invisible to the single-source ratchet by design.
 */
export const INFLIGHT_MMA_STATUS = ['dispatched', 'running'] as const satisfies readonly MmaStatus[];
export type InflightMmaStatus = (typeof INFLIGHT_MMA_STATUS)[number];

/** Every state a batch is FINISHED in — `MMA_STATUS` minus the in-flight ones. */
export type TerminalMmaStatus = Exclude<MmaStatus, InflightMmaStatus>;
export const TERMINAL_MMA_STATUS: readonly TerminalMmaStatus[] = MMA_STATUS.filter(
  (s): s is TerminalMmaStatus => !(INFLIGHT_MMA_STATUS as readonly string[]).includes(s),
);

/* ── Spec 7: Build pipeline ─────────────────────────────────────────────── */

/**
 * export.format — the artifact an export produces. All three are live: `md` is the
 * per-stage raw download, `pdf` renders through `export/pdf` (Chromium in a subprocess),
 * and `bundle` zips a set. `export/record.ts` maps each to its file extension.
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

/** loop.mode — recurring scheduler, manual run-now, or machine-driven event trigger. */
export const LOOP_MODE = ['recurring', 'manual', 'event'] as const;
export type LoopMode = (typeof LOOP_MODE)[number];

/** loop_run.trigger — how a fire was activated. */
export const LOOP_TRIGGER = ['schedule', 'manual', 'event'] as const;
export type LoopTrigger = (typeof LOOP_TRIGGER)[number];

/**
 * loop_run.status — per-repo outcome of a fire. A failed run never opens a PR.
 *
 * Three of the eighteen enum arrays here (REPO_STATUS, LOOP_WORKER_TIER, LOOP_RUN_STATUS)
 * had no companion type, so their consumers fell back to `string` — which is how
 * `RUN_STATUS_LABEL` came to be a `Record<string, string>` that a new status could slip
 * through, showing the user a raw `no_changes`. Every enum here now exports its type.
 */
export const LOOP_RUN_STATUS = ['running', 'changed', 'no_changes', 'failed'] as const;
export type LoopRunStatus = (typeof LOOP_RUN_STATUS)[number];

/* ── Values inside JSONB, not columns ───────────────────────────────────── */

/**
 * `details.stages.exploration.phases.discover.tasks[].kind` — the three lenses a discovery
 * task can take: `investigate` looks inward at a repo, `research` outward at prior art,
 * `journal` backward at the team's own learnings.
 *
 * Not a column (it lives inside the `details` JSONB), which is why it sat outside this file
 * and got written out EIGHT times: the details schema, the propose payload schema, the API
 * route schema, the propose handler's guard AND its sort map, two signatures in
 * `explore-core`, four in `exploration/dispatch.ts`, and two maps in `ExploreStageClient`.
 *
 * One of those copies decided what the user could see. The exploration rail built its groups
 * by iterating a local `KIND_ORDER` map, so a task whose kind was not in THAT object rendered
 * nowhere — dispatched work, paid for and completed, missing from the stage with no empty
 * state to explain it. The value set belongs where the ratchet in
 * `tests/db/enum-single-source.test.ts` can see it.
 */
export const DISCOVER_TASK_KIND = ['investigate', 'research', 'journal'] as const;
export type DiscoverTaskKind = (typeof DISCOVER_TASK_KIND)[number];

/**
 * `ops_notification.kind` — what a user-facing alert is about.
 *
 * The column stays plain `text` on purpose: rows are historical and a kind retired from this
 * list must still render. READERS therefore have to tolerate a value outside it. WRITERS do
 * not — `CreateNotification.kind` is this type, so a typo at a call site fails to compile.
 *
 * That mattered. `NotificationBell` branched on `'section_mention'`, which nothing has ever
 * written (both invite routes write `section_invite`, and the schema comment says so), so the
 * @-glyph that distinguishes an invite was unreachable — and the component's own test fixture
 * used the same non-existent kind, so it was asserting against a value production cannot
 * produce.
 */
export const NOTIFICATION_KIND = ['dispatch_failed', 'section_invite', 'mention'] as const;
export type NotificationKind = (typeof NOTIFICATION_KIND)[number];

/**
 * `project_activity.kind` — what a row on the project timeline represents. `running` is the
 * in-flight state a terminal `done`/`error` RESOLVES IN PLACE (one logical row, not two).
 */
export const ACTIVITY_KIND = ['action', 'running', 'done', 'error'] as const;
export type ActivityKind = (typeof ACTIVITY_KIND)[number];

/** `project_activity.source` — who caused the row: a person, or an MMA worker. */
export const ACTIVITY_SOURCE = ['user', 'mma'] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCE)[number];

/**
 * `project_journal.type` — what kind of learning a harvested row is. This is MMA's OKF node
 * taxonomy, mirrored: the harvest handler writes these straight through to a journal node's
 * frontmatter `type`, so the two vocabularies are one and must not drift. Forge's LEARN-group
 * UI calls the field `category`; the values are the same six.
 */
export const LEARNING_CATEGORIES = ['decision', 'design', 'behavior', 'process', 'knowledge', 'style'] as const;
export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

/**
 * `project_journal.status` — the curation lifecycle of one candidate learning.
 * `proposed` → the user keeps or removes it → `kept` rows are written to the journal and
 * become `recorded`. Both `recorded` and `removed` are TERMINAL and immutable
 * (`assertMutableJournalStatus` enforces it), which is why the curation UI works in the
 * narrower `CuratableLearningStatus` below — it only ever sees rows still in play.
 */
export const JOURNAL_LEARNING_STATUS = ['proposed', 'kept', 'removed', 'recorded'] as const;
export type JournalLearningStatus = (typeof JOURNAL_LEARNING_STATUS)[number];

/**
 * What the curation UI can show. `removed` rows are filtered out before the view is built,
 * so this is derived rather than re-listed: a new status joins it automatically, and a
 * status that becomes terminal has to be excluded here deliberately.
 */
export type CuratableLearningStatus = Exclude<JournalLearningStatus, 'removed'>;

/**
 * The two TERMINAL statuses — a learning in either can no longer be edited or removed.
 *
 * `allowed-actions.ts` expressed this as a positive filter (`proposed || kept`) and
 * `assertMutableJournalStatus` as two negative throws. Equivalent over four values and
 * divergent the moment a fifth arrives: the filter would exclude it (safe), the assert
 * would wave it through (not). Declaring the terminal side and deriving the mutable one
 * means a new status is immutable until somebody says otherwise.
 */
export const TERMINAL_JOURNAL_STATUS = ['removed', 'recorded'] as const satisfies readonly JournalLearningStatus[];
export type TerminalJournalStatus = (typeof TERMINAL_JOURNAL_STATUS)[number];

/** A learning that can still be edited or removed. */
export type MutableJournalStatus = Exclude<JournalLearningStatus, TerminalJournalStatus>;

export const MUTABLE_JOURNAL_STATUS: readonly MutableJournalStatus[] = JOURNAL_LEARNING_STATUS.filter(
  (s): s is MutableJournalStatus => !(TERMINAL_JOURNAL_STATUS as readonly string[]).includes(s),
);

/** True when a learning in this status may still be changed. */
export function isMutableJournalStatus(status: string): status is MutableJournalStatus {
  return (MUTABLE_JOURNAL_STATUS as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// `project.details` JSONB vocabularies. Not columns — but fixed value sets, and the
// single-source ratchet reads only this file (see the header).
// ---------------------------------------------------------------------------

/**
 * `details.…attempts[].status` — one dispatch attempt's lifecycle.
 *
 * `cancelled` (engine 5.16) is terminal-and-INTENTIONAL: a human stopped this attempt.
 * Unlike `failed` it must never trigger a re-dispatch — the stage stays parked until a
 * human acts (see `resolveNextActionFromDetails` / `reconcileStuckAttempts`).
 *
 * This is `MMA_STATUS` minus `dispatched`, deliberately: an attempt is only recorded once
 * it is running, so there is no pre-run state to represent.
 */
export const ATTEMPT_STATUS = ['running', 'done', 'failed', 'cancelled'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUS)[number];

/**
 * Every state a dispatch can END in — `ATTEMPT_STATUS` without the in-flight one.
 *
 * Derived rather than listed. It was written out as `'done' | 'failed' | 'cancelled'` in
 * `sse/envelope.ts` and `details/project-event-labels.ts`, which is a subset and so
 * invisible to the single-source ratchet in both places. A new attempt status now has to
 * be classified as terminal or not, instead of being silently absent here.
 */
export type TerminalAttemptStatus = Exclude<AttemptStatus, 'running'>;

/** `details.stages.exploration.phases.discover.tasks[].status`. */
export const DISCOVER_TASK_STATUS = ['draft', 'running', 'recorded', 'failed'] as const;

/** `details.stages.plan.phases.refine.tasks[].status` — plan-approval through execution. */
export const PLAN_TASK_STATUS = [
  'pending', 'approved', 'queued', 'executing', 'verifying', 'fixing', 'committed', 'skipped', 'failed',
] as const;

/** `details.automation.status` — whether the auto driver is running for this project. */
export const AUTOMATION_STATUS = ['off', 'running'] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUS)[number];
