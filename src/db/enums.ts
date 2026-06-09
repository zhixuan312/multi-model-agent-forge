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
