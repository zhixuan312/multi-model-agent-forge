import { hash, hashSync, verify } from '@node-rs/argon2';
import { z } from 'zod';

/**
 * argon2id algorithm id. `@node-rs/argon2` exposes `Algorithm.Argon2id` as an
 * ambient const enum, which `isolatedModules` forbids accessing — so we pin the
 * numeric value (Argon2id = 2) directly.
 */
const ALGORITHM_ARGON2ID = 2;
import {
  ARGON2_MEMORY_KIB,
  ARGON2_ITERATIONS,
  ARGON2_PARALLELISM,
  PASSWORD_MIN_LENGTH,
} from '@/auth/config';

/**
 * argon2id password hashing (Spec 1 §Auth NFRs / F17, F26).
 *
 * Passwords are *low-entropy* and must resist offline brute-force, so they use
 * argon2id (slow, memory-hard KDF) with OWASP-floor params. Do NOT harmonize
 * this with the sha256 session-token hashing — that's a deliberate asymmetry
 * (high-entropy CSPRNG tokens don't need a slow KDF).
 */
export const ARGON2_OPTS = {
  algorithm: ALGORITHM_ARGON2ID,
  memoryCost: ARGON2_MEMORY_KIB,
  timeCost: ARGON2_ITERATIONS,
  parallelism: ARGON2_PARALLELISM,
} as const;

/** Hash a plaintext password with the pinned argon2id params. */
export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTS);
}

/** Verify a plaintext password against an argon2id PHC hash. Never throws on a
 *  mismatch — returns false (a malformed hash also resolves to false). */
export async function verifyPassword(plaintext: string, phcHash: string): Promise<boolean> {
  try {
    return await verify(phcHash, plaintext, ARGON2_OPTS);
  } catch {
    return false;
  }
}

/**
 * A precomputed argon2id hash of a throwaway constant, used by the login
 * timing-equality path: when the username is unknown we verify against THIS
 * dummy hash instead of returning early, so the dominant KDF cost is paid on
 * both the unknown-user and wrong-password paths (Spec 1 "Timing-equality").
 *
 * Computed once at module load with the configured params. Verifying any real
 * password against it always returns false.
 */
export const DUMMY_ARGON2_HASH: string = hashSync(
  'forge-dummy-password-for-timing-equality',
  ARGON2_OPTS,
);

/**
 * The shared password Zod schema — reused by login, create, reset, and change
 * flows. Non-empty and ≥ PASSWORD_MIN_LENGTH (F4/F12).
 */
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH);
