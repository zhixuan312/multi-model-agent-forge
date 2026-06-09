// @vitest-environment node
import { getDb } from '@/db/client';
import { teamSettings } from '@/db/schema/config';
import { getConnections, updateConnections } from '@/config/connections-core';
import { cleanupConfig, makeFakeSecretStore } from './config-fixtures';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('connections-core (live DB)', () => {
  const db = getDb();

  beforeEach(async () => {
    await db.delete(teamSettings);
  });

  afterAll(async () => {
    await cleanupConfig();
  });

  it('empty view when no row exists yet', async () => {
    const view = await getConnections({ db });
    expect(view).toEqual({
      mmaBaseUrl: null,
      mmaTokenSet: false,
      gitTokenSet: false,
      openaiTranscriptionKeySet: false,
    });
  });

  it('first save creates the singleton row; tokens become refs, not plaintext', async () => {
    const secrets = makeFakeSecretStore();
    const res = await updateConnections(
      {
        mmaBaseUrl: 'http://127.0.0.1:7337',
        mmaToken: 'mma_BEARER_SECRET',
        gitToken: 'ghs_GIT_SECRET',
      },
      { db, secrets },
    );
    expect(res.kind).toBe('saved');
    if (res.kind !== 'saved') return;
    expect(res.connections.mmaBaseUrl).toBe('http://127.0.0.1:7337');
    expect(res.connections.mmaTokenSet).toBe(true);
    expect(res.connections.gitTokenSet).toBe(true);

    // Both tokens went through the store.
    expect(secrets.puts.map((p) => p.plaintext)).toEqual(
      expect.arrayContaining(['mma_BEARER_SECRET', 'ghs_GIT_SECRET']),
    );

    // The DB row holds refs, never the plaintext tokens.
    const [row] = await db.select().from(teamSettings).limit(1);
    expect(row.mmaTokenRef).not.toContain('mma_BEARER_SECRET');
    expect(row.gitTokenRef).not.toContain('ghs_GIT_SECRET');
    expect(JSON.stringify(row)).not.toContain('mma_BEARER_SECRET');
    expect(JSON.stringify(row)).not.toContain('ghs_GIT_SECRET');
    // Refs match what the store handed back.
    const refs = secrets.puts.map((p) => p.ref);
    expect(refs).toContain(row.mmaTokenRef);
    expect(refs).toContain(row.gitTokenRef);
  });

  it('second save updates the SAME singleton row (no second row)', async () => {
    await updateConnections(
      { mmaBaseUrl: 'http://127.0.0.1:7337', mmaToken: 'a', gitToken: 'b' },
      { db, secrets: makeFakeSecretStore() },
    );
    await updateConnections({ mmaBaseUrl: 'http://localhost:9000' }, { db, secrets: makeFakeSecretStore() });

    const rows = await db.select().from(teamSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].mmaBaseUrl).toBe('http://localhost:9000');
  });

  it('MMA-only edit leaves the git ref untouched (sections update independently)', async () => {
    const s1 = makeFakeSecretStore();
    await updateConnections(
      { mmaBaseUrl: 'http://127.0.0.1:7337', mmaToken: 'mma-1', gitToken: 'git-1' },
      { db, secrets: s1 },
    );
    const [before] = await db.select().from(teamSettings).limit(1);

    // Edit ONLY the MMA token; git token absent → its ref must not change.
    const s2 = makeFakeSecretStore();
    await updateConnections({ mmaToken: 'mma-2' }, { db, secrets: s2 });
    const [after] = await db.select().from(teamSettings).limit(1);

    expect(after.gitTokenRef).toBe(before.gitTokenRef); // unchanged
    expect(after.mmaTokenRef).not.toBe(before.mmaTokenRef); // rotated
    expect(s2.deleted).toContain(before.mmaTokenRef); // old MMA secret dropped
  });

  it('stores the OpenAI transcription key as a ref', async () => {
    const secrets = makeFakeSecretStore();
    const res = await updateConnections(
      { openaiTranscriptionKey: 'sk-openai-xyz' },
      { db, secrets },
    );
    expect(res.kind).toBe('saved');
    if (res.kind !== 'saved') return;
    expect(res.connections.openaiTranscriptionKeySet).toBe(true);
    const [row] = await db.select().from(teamSettings).limit(1);
    expect(row.openaiTranscriptionKeyRef).not.toContain('sk-openai-xyz');
  });
});
