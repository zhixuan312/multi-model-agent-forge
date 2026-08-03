/**
 * Postgres error shapes the application reacts to.
 *
 * `isUniqueViolation` existed twice (members-core, repos-core) as a bare `code === '23505'`
 * check. Both call sites turn it into a user-facing "that name is taken" instead of a 500,
 * so the two must agree about what a duplicate looks like.
 */

/** `unique_violation` — a UNIQUE constraint or index rejected the write. */
const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
