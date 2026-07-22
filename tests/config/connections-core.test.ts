// @vitest-environment node
import { getConnections, updateConnections, updateConnectionsSchema } from '@/config/connections-core';
import { createMockDb, createMockSecretStore, seq } from '../test-utils/mock-db';
import { createBaseConnection } from '../test-utils/factories';

// Backend tests run entirely on a mocked Drizzle `Db` + `SecretStore` (the gumi
// convention) — no database is ever touched. The MMA bearer is intentionally NOT
// a Connections field: it is owned by the local mma engine and read from its
// auth-token file, never written through this route.

describe('updateConnectionsSchema (input contract)', () => {
  it('accepts a full payload and trims values', () => {
    const r = updateConnectionsSchema.safeParse({
      mmaBaseUrl: '  http://127.0.0.1:7337  ',
      gitToken: ' ghs_x ',
      openaiTranscriptionKey: ' sk_x ',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual({ mmaBaseUrl: 'http://127.0.0.1:7337', gitToken: 'ghs_x', openaiTranscriptionKey: 'sk_x' });
  });

  it('treats blank/whitespace fields as "unchanged" (undefined), so sections save independently', () => {
    const r = updateConnectionsSchema.safeParse({ mmaBaseUrl: 'http://x', gitToken: '   ', openaiTranscriptionKey: '' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.gitToken).toBeUndefined();
    expect(r.data.openaiTranscriptionKey).toBeUndefined();
  });

  it('an empty object is valid; a non-string field is rejected; mmaToken is stripped', () => {
    expect(updateConnectionsSchema.safeParse({}).success).toBe(true);
    expect(updateConnectionsSchema.safeParse({ gitToken: 123 }).success).toBe(false);
    const r = updateConnectionsSchema.safeParse({ mmaToken: 'x' });
    expect(r.success && 'mmaToken' in r.data).toBe(false);
  });
});

describe('getConnections', () => {
  it('returns the empty view when no row exists yet', async () => {
    const db = createMockDb();
    expect(await getConnections({ db })).toEqual({
      mmaBaseUrl: null,
      gitTokenSet: false,
      openaiTranscriptionKeySet: false,
    });
  });

  it('maps stored refs to "set" booleans (never the values)', async () => {
    const db = createMockDb({
      'select:team_connection': [createBaseConnection({ openaiTranscriptionKeyRef: null })],
    });
    expect(await getConnections({ db })).toEqual({
      mmaBaseUrl: 'http://127.0.0.1:7337',
      gitTokenSet: false,
      openaiTranscriptionKeySet: false,
    });
  });

  it('reads org-owned base URL and team-owned git token separately', async () => {
    const db = createMockDb({
      'select:team_connection': [{ id: 'conn-1', mmaBaseUrl: 'http://127.0.0.1:7337', openaiTranscriptionKeyRef: 'voice-ref' }],
      'select:team': [{ id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base/alpha', gitTokenRef: 'git-ref' }],
    });
    const view = await getConnections({ db, teamId: 'team-1' });
    expect(view.mmaBaseUrl).toBe('http://127.0.0.1:7337');
    expect(view.gitTokenSet).toBe(true);
    expect(view.openaiTranscriptionKeySet).toBe(true);
  });
});

describe('updateConnections', () => {
  it('rejects invalid input without writing', async () => {
    const db = createMockDb();
    const res = await updateConnections({ gitToken: 123 }, { db, secrets: createMockSecretStore() });
    expect(res.kind).toBe('invalid');
    expect(db._calls).toHaveLength(0);
  });

  it('when no teamId is provided, git token is ignored (no-op)', async () => {
    const db = createMockDb({
      'select:team_connection': seq([], [createBaseConnection()]),
    });
    const secrets = createMockSecretStore();
    const res = await updateConnections({ gitToken: 'ghs_SECRET' }, { db, secrets });

    expect(res.kind).toBe('saved');
    if (res.kind !== 'saved') return;
    expect(res.connections.gitTokenSet).toBe(false); // no teamId provided, so git token not set
    expect(secrets.puts).toHaveLength(0); // no secrets stored
    expect(db._assertCalled('team', 'update')).toBe(false); // team not updated
  });

  it('mma base URL alone (no git token, no team) UPDATEs the singleton — org admin', async () => {
    const existing = createBaseConnection({ openaiTranscriptionKeyRef: 'keep-openai' });
    const db = createMockDb({
      'select:team_connection': seq([existing], [{ ...existing, mmaBaseUrl: 'http://new-url' }]),
    });
    const secrets = createMockSecretStore();
    // mmaBaseUrl is an org-owned singleton field → requires an org admin (isOrgAdmin).
    await updateConnections({ mmaBaseUrl: 'http://new-url' }, { db, secrets, isOrgAdmin: true });

    expect(secrets.puts).toHaveLength(0); // no new secrets
    expect(db._assertCalled('team_connection', 'update')).toBe(true);

    const set = db._callsFor('team_connection').find((c) => c.method === 'set');
    expect(JSON.stringify(set?.args)).toContain('http://new-url'); // url updated
    expect(JSON.stringify(set?.args)).not.toContain('openaiTranscriptionKeyRef'); // openai not in the patch
  });

  it('updates git token on the team row, not the singleton row', async () => {
    const db = createMockDb({
      'select:team_connection': seq([{ id: 'conn-1', mmaBaseUrl: 'http://127.0.0.1:7337', openaiTranscriptionKeyRef: null }], [{ id: 'conn-1', mmaBaseUrl: 'http://127.0.0.1:7337', openaiTranscriptionKeyRef: null }]),
      'select:team': seq([{ id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base/alpha', gitTokenRef: 'old-ref' }], [{ id: 'team-1', name: 'Alpha', slug: 'alpha', workspaceRootPath: '/forge/base/alpha', gitTokenRef: 'secret-ref-1' }]),
    });
    const secrets = createMockSecretStore();
    await updateConnections({ gitToken: 'ghs_secret' }, { db, teamId: 'team-1', secrets });
    expect(db._assertCalled('team', 'update')).toBe(true);
    expect(db._assertCalled('team_connection', 'update')).toBe(false);
  });
});


describe('updateConnections — org-owned fields are org_admin only (speech-to-text key)', () => {
  it('DROPS openaiTranscriptionKey for a non-org-admin — never rotates the app-wide key', async () => {
    const db = createMockDb({ 'select:team_connection': [createBaseConnection({ openaiTranscriptionKeyRef: 'keep' })] });
    const secrets = createMockSecretStore();
    await updateConnections({ openaiTranscriptionKey: 'sk_new' }, { db, secrets, teamId: 't1', isOrgAdmin: false });
    expect(secrets.puts.some((p) => p.label === 'openai-transcription')).toBe(false);
    expect(db._assertCalled('team_connection', 'update')).toBe(false);
  });

  it('applies openaiTranscriptionKey for an org admin', async () => {
    const db = createMockDb({
      'select:team_connection': [createBaseConnection({ openaiTranscriptionKeyRef: null })],
      'update:team_connection': [{ id: 'conn-1' }],
    });
    const secrets = createMockSecretStore();
    await updateConnections({ openaiTranscriptionKey: 'sk_new' }, { db, secrets, isOrgAdmin: true });
    expect(secrets.puts.some((p) => p.label === 'openai-transcription')).toBe(true);
  });

  it('a team admin can still rotate the team git token without isOrgAdmin', async () => {
    const db = createMockDb({
      'select:team_connection': [createBaseConnection({})],
      'select:team': [{ id: 't1', gitTokenRef: null }],
      'update:team': [{ id: 't1' }],
    });
    const secrets = createMockSecretStore();
    await updateConnections({ gitToken: 'ghs_x' }, { db, secrets, teamId: 't1', isOrgAdmin: false });
    expect(secrets.puts.some((p) => p.label === 'git-token')).toBe(true);
    expect(db._assertCalled('team', 'update')).toBe(true);
  });
});
