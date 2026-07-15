const FIXED = new Date('2026-01-01T00:00:00.000Z');
const WARM_EMBER = '#9a6b4f';

export function createBaseMember(over: Partial<{
  id: string; username: string; displayName: string; avatarTint: string;
  role: string; teamId: string | null; createdAt: Date;
}> = {}) {
  return {
    id: 'member-1',
    username: 'ada',
    displayName: 'Ada Lovelace',
    avatarTint: WARM_EMBER,
    role: 'member',
    teamId: 'team-1',
    createdAt: FIXED,
    ...over,
  };
}

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

export function createBaseConnection(over: Partial<{
  id: string; mmaBaseUrl: string | null;
  openaiTranscriptionKeyRef: string | null; createdAt: Date; updatedAt: Date;
}> = {}) {
  return {
    id: 'conn-1',
    mmaBaseUrl: 'http://127.0.0.1:7337',
    openaiTranscriptionKeyRef: null,
    createdAt: FIXED,
    updatedAt: FIXED,
    ...over,
  };
}

export function createBaseComponentGovernance(over: Partial<{
  id: string;
  slotStateJson: Record<string, { locked: boolean; knobs: Record<string, string | boolean> }>;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: 'component-governance-1',
    slotStateJson: {},
    createdAt: FIXED,
    updatedAt: FIXED,
    ...over,
  };
}
