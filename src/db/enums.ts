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
