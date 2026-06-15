/**
 * In-memory row factories for backend tests — build the canned rows you feed to
 * `createMockDb`. Each returns a full table row (matching the Drizzle
 * `$inferSelect` shape) with sensible defaults; pass overrides for the fields a
 * test cares about. No database is involved.
 */
const FIXED = new Date('2026-01-01T00:00:00.000Z');
const WARM_EMBER = '#9a6b4f';

/** `iam_member` row. */
export function createBaseMember(over: Partial<{
  id: string; username: string; displayName: string; avatarTint: string;
  isAdmin: boolean; createdAt: Date;
}> = {}) {
  return {
    id: 'member-1',
    username: 'ada',
    displayName: 'Ada Lovelace',
    avatarTint: WARM_EMBER,
    isAdmin: false,
    createdAt: FIXED,
    ...over,
  };
}

/** `iam_identity` row (local auth). */
export function createBaseIdentity(over: Partial<{
  id: string; memberId: string; provider: string; passwordHash: string | null;
  passwordChangedAt: Date | null; createdAt: Date;
}> = {}) {
  return {
    id: 'identity-1',
    memberId: 'member-1',
    provider: 'local',
    passwordHash: '$argon2id$dummy',
    passwordChangedAt: null,
    createdAt: FIXED,
    ...over,
  };
}

/** `iam_session` row. */
export function createBaseSession(over: Partial<{
  id: string; memberId: string; tokenHash: string; lastUsedAt: Date;
  expiresAt: Date; createdAt: Date;
}> = {}) {
  return {
    id: 'session-1',
    memberId: 'member-1',
    tokenHash: 'hash-1',
    lastUsedAt: FIXED,
    expiresAt: new Date(FIXED.getTime() + 30 * 24 * 60 * 60 * 1000),
    createdAt: FIXED,
    ...over,
  };
}

/** `settings_connection` singleton row. */
export function createBaseConnection(over: Partial<{
  id: string; mmaBaseUrl: string | null; gitTokenRef: string | null;
  openaiTranscriptionKeyRef: string | null; createdAt: Date; updatedAt: Date;
}> = {}) {
  return {
    id: 'conn-1',
    mmaBaseUrl: 'http://127.0.0.1:7337',
    gitTokenRef: null,
    openaiTranscriptionKeyRef: null,
    createdAt: FIXED,
    updatedAt: FIXED,
    ...over,
  };
}

/** `provider` row. */
export function createBaseProvider(over: Partial<{
  id: string; name: string; type: 'claude' | 'codex'; baseUrl: string | null;
  apiKeyRef: string | null; createdAt: Date;
}> = {}) {
  return {
    id: 'provider-1',
    name: 'Claude',
    type: 'claude' as const,
    baseUrl: null,
    apiKeyRef: null,
    createdAt: FIXED,
    ...over,
  };
}

/** `agent_tier` row. */
export function createBaseTier(over: Partial<{
  tier: 'main' | 'complex' | 'standard'; providerId: string | null;
  model: string | null; updatedAt: Date;
}> = {}) {
  return {
    tier: 'main' as const,
    providerId: null,
    model: null,
    updatedAt: FIXED,
    ...over,
  };
}
