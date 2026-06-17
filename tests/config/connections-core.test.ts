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
      team_connection: [createBaseConnection({ gitTokenRef: 'r1', openaiTranscriptionKeyRef: null })],
    });
    expect(await getConnections({ db })).toEqual({
      mmaBaseUrl: 'http://127.0.0.1:7337',
      gitTokenSet: true,
      openaiTranscriptionKeySet: false,
    });
  });
});

describe('updateConnections', () => {
  it('rejects invalid input without writing', async () => {
    const db = createMockDb();
    const res = await updateConnections({ gitToken: 123 }, { db, secrets: createMockSecretStore() });
    expect(res.kind).toBe('invalid');
    expect(db._calls).toHaveLength(0);
  });

  it('first save INSERTs the singleton; tokens become refs, plaintext never reaches the row', async () => {
    const db = createMockDb({
      'select:team_connection': seq([], [createBaseConnection({ gitTokenRef: 'secret-ref-1' })]),
    });
    const secrets = createMockSecretStore();
    const res = await updateConnections({ gitToken: 'ghs_SECRET' }, { db, secrets });

    expect(res.kind).toBe('saved');
    if (res.kind !== 'saved') return;
    expect(res.connections.gitTokenSet).toBe(true);
    expect(secrets.puts).toContainEqual(expect.objectContaining({ label: 'git-token', plaintext: 'ghs_SECRET' }));
    expect(db._assertCalled('team_connection', 'insert')).toBe(true);

    const values = db._callsFor('team_connection').find((c) => c.method === 'values');
    expect(JSON.stringify(values?.args)).not.toContain('ghs_SECRET'); // ref, not plaintext
    expect(JSON.stringify(values?.args)).toContain('secret-ref-1');
  });

  it('a git-only edit UPDATEs the existing row, rotates the git secret, and leaves speech-to-text untouched', async () => {
    const existing = createBaseConnection({ gitTokenRef: 'old-git', openaiTranscriptionKeyRef: 'keep-openai' });
    const db = createMockDb({
      'select:team_connection': seq([existing], [{ ...existing, gitTokenRef: 'secret-ref-1' }]),
    });
    const secrets = createMockSecretStore();
    await updateConnections({ gitToken: 'new-git' }, { db, secrets });

    expect(secrets.puts.some((p) => p.label === 'git-token')).toBe(true);
    expect(secrets.deleted).toContain('old-git'); // superseded secret dropped
    expect(db._assertCalled('team_connection', 'update')).toBe(true);

    const set = db._callsFor('team_connection').find((c) => c.method === 'set');
    expect(JSON.stringify(set?.args)).toContain('secret-ref-1'); // git ref rotated
    expect(JSON.stringify(set?.args)).not.toContain('openaiTranscriptionKeyRef'); // openai not in the patch
  });
});
