import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashToken } from '@/auth/cookie';

const EVENT_TOKEN_BYTES = 32;

export function mintEventToken(): string {
  return randomBytes(EVENT_TOKEN_BYTES).toString('base64url');
}

export function hashEventToken(token: string): string {
  return hashToken(token.trim());
}

export function verifyEventToken(candidate: string, storedHash: string | null | undefined): boolean {
  const normalizedCandidate = candidate.trim();
  const normalizedHash = storedHash?.trim() ?? '';
  if (!normalizedCandidate || !normalizedHash) return false;
  // Compare the two hashes with a timing-safe equality check so a caller cannot
  // learn the stored hash byte-by-byte from response-time differences. Both sides
  // are hex sha256 digests of identical length; guard length first because
  // timingSafeEqual throws on mismatched buffer lengths.
  const a = Buffer.from(hashEventToken(normalizedCandidate));
  const b = Buffer.from(normalizedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
