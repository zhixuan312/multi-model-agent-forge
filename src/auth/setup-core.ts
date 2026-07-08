import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ForgeRole } from '@/auth/auth-provider';
import { getDb, type Db } from '@/db/client';
import { member, memberIdentity } from '@/db/schema/identity';
import { hashPassword } from '@/auth/password';
import { createMemberSchema } from '@/auth/members-core';
import { logEvent } from '@/observability/log-event';

/**
 * First-run admin setup core (replaces the env-seeded `seedFirstAdmin`).
 *
 * The `/setup` page is a ONE-TIME registration screen: it is available only
 * while the team has zero members, and its single output is the first admin
 * (`is_admin = true`). Once any member exists the gate is permanently closed —
 * the page redirects to `/login` and `registerFirstAdmin` refuses
 * (`already_setup`). This is the only way the first admin is ever created;
 * there is no env-var bootstrap.
 *
 * Pure of `next/headers` so it's unit-testable against the live DB. The page +
 * server action (`app/(auth)/setup/**`) are thin shells over these functions.
 */

/** True when the team has no members yet — the only state in which setup runs. */
export async function isFirstRun(db: Db = getDb()): Promise<boolean> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member);
  return count === 0;
}

export interface CreatedAdmin {
  id: string;
  username: string;
  displayName: string;
  avatarTint: string;
  role: ForgeRole;
}

/**
 * Insert one `org_admin` member + its single `local` identity (argon2id hash).
 * No gate of its own — `registerFirstAdmin` owns the zero-members check; this
 * is the pure insertion primitive (mirrors `createMember`, but org admin role).
 */
export async function createAdminMember(
  db: Db,
  input: { displayName: string; username: string; password: string },
): Promise<CreatedAdmin> {
  const passwordHash = await hashPassword(input.password);
  const [m] = await db
    .insert(member)
    .values({ username: input.username, displayName: input.displayName, role: 'org_admin' })
    .returning({
      id: member.id,
      username: member.username,
      displayName: member.displayName,
      avatarTint: member.avatarTint,
      role: member.role,
    });
  await db.insert(memberIdentity).values({
    memberId: m.id,
    passwordHash,
  });
  return m;
}

export type RegisterFirstAdminResult =
  | { kind: 'created'; member: CreatedAdmin }
  | { kind: 'invalid' }
  | { kind: 'already_setup' };

export interface SetupDeps {
  db?: Db;
}

/**
 * Create the first admin from a setup submission. Gated on a zero-member count
 * (re-checked inside the transaction so the gate + insert are atomic): if any
 * member already exists this is a no-op `already_setup`.
 */
export async function registerFirstAdmin(
  input: unknown,
  deps: SetupDeps = {},
): Promise<RegisterFirstAdminResult> {
  const db = deps.db ?? getDb();
  const parsed = createMemberSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };

  return db.transaction(async (tx) => {
    if (!(await isFirstRun(tx))) return { kind: 'already_setup' };
    const created = await createAdminMember(tx, parsed.data);
    logEvent({ level: 'info', event: 'member.create', targetId: created.id });
    return { kind: 'created', member: created };
  });
}

/**
 * Setup form shape: the create fields plus a confirmation. `displayName` /
 * `username` are trimmed; passwords are never trimmed.
 */
export const setupFormSchema = createMemberSchema.extend({
  confirmPassword: z.string().min(1),
});

export type ParseSetupFormResult =
  | { ok: true; data: { displayName: string; username: string; password: string } }
  | { ok: false; error: 'invalid' | 'passwords_mismatch' };

/**
 * Validate a raw setup submission. Field/length errors surface as `invalid`;
 * a well-formed submission whose confirmation doesn't match surfaces as
 * `passwords_mismatch`. On success, `confirmPassword` is dropped.
 */
export function parseSetupForm(raw: unknown): ParseSetupFormResult {
  const parsed = setupFormSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { displayName, username, password, confirmPassword } = parsed.data;
  if (password !== confirmPassword) return { ok: false, error: 'passwords_mismatch' };
  return { ok: true, data: { displayName, username, password } };
}
