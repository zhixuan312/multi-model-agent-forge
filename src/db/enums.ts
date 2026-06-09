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
