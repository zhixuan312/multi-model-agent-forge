// @vitest-environment node
// Server-side crypto: libsodium's WASM realm-checks Uint8Array, so this layer is
// tested under the Node environment (jsdom swaps the global Uint8Array realm and
// breaks crypto_secretbox). The DB + secrets layer is Node-runtime code anyway.
import sodium from 'libsodium-wrappers';
import {
  decryptSecret,
  encryptSecret,
  loadMasterKey,
  PostgresSecretStore,
  sodiumReady,
  type SecretStore,
} from '@/secrets/secret-store';

/** Generate a fresh, valid 32-byte base64 master key for a test. */
async function makeTestKeyBase64(): Promise<string> {
  await sodiumReady();
  const raw = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  return sodium.to_base64(raw, sodium.base64_variants.ORIGINAL);
}

describe('encrypt/decrypt round-trip (pure, no DB)', () => {
  let key: Uint8Array;
  beforeAll(async () => {
    key = loadMasterKey(await makeTestKeyBase64());
  });

  it('decrypt(encrypt(x)) === x', () => {
    const plaintext = 'mma-bearer-token-超-секрет-🔐';
    const enc = encryptSecret(plaintext, key);
    expect(decryptSecret(enc, key)).toBe(plaintext);
  });

  it('ciphertext differs from plaintext', () => {
    const plaintext = 'git-token-abcdef';
    const enc = encryptSecret(plaintext, key);
    expect(enc).not.toBe(plaintext);
    expect(enc).not.toContain(plaintext);
  });

  it('two encryptions of the same value differ (random nonce)', () => {
    const plaintext = 'same-secret';
    const a = encryptSecret(plaintext, key);
    const b = encryptSecret(plaintext, key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe(plaintext);
    expect(decryptSecret(b, key)).toBe(plaintext);
  });

  it('a wrong key fails to decrypt (MAC failure, not garbage)', async () => {
    const wrongKey = loadMasterKey(await makeTestKeyBase64());
    const enc = encryptSecret('top-secret', key);
    expect(() => decryptSecret(enc, wrongKey)).toThrow();
  });

  it('a tampered value_enc fails authentication on decrypt', () => {
    const enc = encryptSecret('untampered', key);
    const chars = enc.split('');
    const idx = enc.length - 3;
    chars[idx] = chars[idx] === 'A' ? 'B' : 'A';
    const tampered = chars.join('');
    expect(() => decryptSecret(tampered, key)).toThrow();
  });
});

describe('loadMasterKey validation (fail-fast)', () => {
  beforeAll(async () => {
    await sodiumReady();
  });

  it('rejects a missing/blank key', () => {
    expect(() => loadMasterKey(undefined)).toThrow(/not set/i);
    expect(() => loadMasterKey('')).toThrow(/not set/i);
    expect(() => loadMasterKey('   ')).toThrow(/not set/i);
  });

  it('rejects a key that does not decode to 32 bytes', async () => {
    await sodiumReady();
    const shortKey = sodium.to_base64(
      sodium.randombytes_buf(16),
      sodium.base64_variants.ORIGINAL,
    );
    expect(() => loadMasterKey(shortKey)).toThrow(/32 bytes/i);
  });

  it('accepts a valid 32-byte base64 key', async () => {
    const decoded = loadMasterKey(await makeTestKeyBase64());
    expect(decoded.length).toBe(32);
  });
});

/**
 * A fake row-backed SecretStore exercises the get/put/delete interface seam
 * end-to-end with the REAL encrypt/decrypt helpers, without a live DB. It proves
 * the contract a second impl (e.g. a future Vault store) must satisfy:
 *   - put returns an id usable as a *_ref
 *   - the stored value_enc is base64(nonce‖ciphertext), never the plaintext
 *   - get round-trips the plaintext
 *   - delete removes the row → get returns null
 */
class FakeSecretStore implements SecretStore {
  private rows = new Map<string, { label: string; valueEnc: string; createdBy: string | null }>();
  private counter = 0;
  // exposed for the value_enc-shape assertion
  readonly raw = new Map<string, string>(); // id → value_enc

  constructor(private readonly key: Uint8Array) {}

  async put(label: string, plaintext: string, createdBy?: string | null): Promise<string> {
    const valueEnc = encryptSecret(plaintext, this.key);
    const id = `id-${++this.counter}`;
    this.rows.set(id, { label, valueEnc, createdBy: createdBy ?? null });
    this.raw.set(id, valueEnc);
    return id;
  }

  async get(id: string): Promise<string | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    return decryptSecret(row.valueEnc, this.key);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
    this.raw.delete(id);
  }
}

describe('SecretStore interface seam (fake row store, real crypto)', () => {
  let store: FakeSecretStore;
  beforeAll(async () => {
    store = new FakeSecretStore(loadMasterKey(await makeTestKeyBase64()));
  });

  it('put → get round-trips the plaintext; id serves as a *_ref', async () => {
    const id = await store.put('mma-bearer', 'super-secret-value');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(await store.get(id)).toBe('super-secret-value');
  });

  it('value_enc is base64(nonce‖ciphertext) and never the plaintext', async () => {
    const id = await store.put('git-token', 'plaintext-token');
    const valueEnc = store.raw.get(id)!;
    expect(valueEnc).not.toContain('plaintext-token');
    // it is valid base64 that decrypts back to the plaintext
    expect(await store.get(id)).toBe('plaintext-token');
  });

  it('delete(id) removes the row → subsequent get(id) is null', async () => {
    const id = await store.put('temp', 'to-be-deleted');
    await store.delete(id);
    expect(await store.get(id)).toBeNull();
  });
});

// Live-Postgres round-trip — only when a real DATABASE_URL is configured.
describe.skipIf(!process.env.DATABASE_URL)('PostgresSecretStore (live DB)', () => {
  it('put → get round-trips and delete removes the row', async () => {
    const store = await PostgresSecretStore.create({ base64Key: await makeTestKeyBase64() });
    const id = await store.put('mma-bearer', 'live-secret');
    expect(await store.get(id)).toBe('live-secret');
    await store.delete(id);
    expect(await store.get(id)).toBeNull();
  });
});
