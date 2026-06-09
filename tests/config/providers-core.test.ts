// @vitest-environment node
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { provider } from '@/db/schema/config';
import {
  createProvider,
  listProviders,
  updateProvider,
  deleteProvider,
} from '@/config/providers-core';
import { cleanupConfig, uniqueName, makeFakeSecretStore } from './config-fixtures';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('providers-core (live DB)', () => {
  const db = getDb();

  afterAll(async () => {
    await cleanupConfig();
  });

  it('creates a provider with an api key stored as a ref, not plaintext', async () => {
    const secrets = makeFakeSecretStore();
    const name = uniqueName('create');
    const res = await createProvider(
      { name, type: 'codex', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-SUPER-SECRET' },
      { db, secrets },
    );
    expect(res.kind).toBe('created');
    if (res.kind !== 'created') return;

    // The view never carries the key — only the boolean flag.
    expect(res.provider.apiKeySet).toBe(true);
    expect(JSON.stringify(res.provider)).not.toContain('sk-SUPER-SECRET');

    // The secret went through the store; the DB column holds the ref, not plaintext.
    expect(secrets.puts).toHaveLength(1);
    const [row] = await db
      .select({ apiKeyRef: provider.apiKeyRef })
      .from(provider)
      .where(eq(provider.id, res.provider.id));
    expect(row.apiKeyRef).toBe(secrets.puts[0].ref);
    expect(row.apiKeyRef).not.toContain('sk-SUPER-SECRET');
  });

  it('creates a provider with NO key → api_key_ref NULL (provider default)', async () => {
    const secrets = makeFakeSecretStore();
    const res = await createProvider(
      { name: uniqueName('nokey'), type: 'claude' },
      { db, secrets },
    );
    expect(res.kind).toBe('created');
    if (res.kind !== 'created') return;
    expect(res.provider.apiKeySet).toBe(false);
    expect(res.provider.baseUrl).toBeNull();
    expect(secrets.puts).toHaveLength(0); // no key → store untouched
  });

  it('rejects a duplicate name', async () => {
    const name = uniqueName('dup');
    await createProvider({ name, type: 'claude' }, { db, secrets: makeFakeSecretStore() });
    const res = await createProvider({ name, type: 'codex' }, { db, secrets: makeFakeSecretStore() });
    expect(res.kind).toBe('duplicate_name');
  });

  it('rejects an invalid type', async () => {
    const res = await createProvider(
      { name: uniqueName('bad'), type: 'openai' },
      { db, secrets: makeFakeSecretStore() },
    );
    expect(res.kind).toBe('invalid');
  });

  it('lists providers (newest-created ordering) exposing apiKeySet only', async () => {
    const secrets = makeFakeSecretStore();
    await createProvider({ name: uniqueName('list'), type: 'claude', apiKey: 'key-1' }, { db, secrets });
    const all = await listProviders({ db });
    const created = all.find((p) => p.name.includes('list'));
    expect(created).toBeDefined();
    expect(created!.apiKeySet).toBe(true);
    expect(Object.keys(created!)).not.toContain('apiKeyRef');
  });

  it('updates name + base URL and rotates the key', async () => {
    const secrets = makeFakeSecretStore();
    const created = await createProvider(
      { name: uniqueName('upd'), type: 'claude', apiKey: 'old-key' },
      { db, secrets },
    );
    if (created.kind !== 'created') throw new Error('setup failed');
    const oldRef = secrets.puts[0].ref;

    const newName = uniqueName('upd2');
    const res = await updateProvider(
      created.provider.id,
      { name: newName, baseUrl: 'https://new.example.com', apiKey: 'new-key' },
      { db, secrets },
    );
    expect(res.kind).toBe('updated');
    if (res.kind !== 'updated') return;
    expect(res.provider.name).toBe(newName);
    expect(res.provider.baseUrl).toBe('https://new.example.com');
    expect(res.provider.apiKeySet).toBe(true);
    // The old secret was superseded (rotated) and the new one stored.
    expect(secrets.deleted).toContain(oldRef);
    expect(secrets.puts.at(-1)!.plaintext).toBe('new-key');
  });

  it('update with a blank apiKey clears the stored key → api_key_ref NULL', async () => {
    const secrets = makeFakeSecretStore();
    const created = await createProvider(
      { name: uniqueName('clear'), type: 'claude', apiKey: 'will-clear' },
      { db, secrets },
    );
    if (created.kind !== 'created') throw new Error('setup failed');
    const ref = secrets.puts[0].ref;

    const res = await updateProvider(created.provider.id, { apiKey: '' }, { db, secrets });
    expect(res.kind).toBe('updated');
    if (res.kind !== 'updated') return;
    expect(res.provider.apiKeySet).toBe(false);
    expect(secrets.deleted).toContain(ref);
  });

  it('update on an unknown id → not_found', async () => {
    const res = await updateProvider(
      '00000000-0000-0000-0000-000000000000',
      { name: uniqueName('x') },
      { db, secrets: makeFakeSecretStore() },
    );
    expect(res.kind).toBe('not_found');
  });

  it('deletes a provider and drops its stored key', async () => {
    const secrets = makeFakeSecretStore();
    const created = await createProvider(
      { name: uniqueName('del'), type: 'claude', apiKey: 'doomed' },
      { db, secrets },
    );
    if (created.kind !== 'created') throw new Error('setup failed');
    const ref = secrets.puts[0].ref;

    const res = await deleteProvider(created.provider.id, { db, secrets });
    expect(res.kind).toBe('deleted');
    expect(secrets.deleted).toContain(ref);
    const rows = await db.select().from(provider).where(eq(provider.id, created.provider.id));
    expect(rows).toHaveLength(0);
  });

  it('delete on an unknown id → not_found', async () => {
    const res = await deleteProvider('00000000-0000-0000-0000-000000000000', {
      db,
      secrets: makeFakeSecretStore(),
    });
    expect(res.kind).toBe('not_found');
  });
});
