import { randomBytes } from 'node:crypto';
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
  return hashEventToken(normalizedCandidate) === normalizedHash;
}
