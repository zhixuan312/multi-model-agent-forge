import sodium from 'libsodium-wrappers';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appSecrets } from '@/db/schema/identity';

/**
 * Encrypted secret storage — libsodium `crypto_secretbox` (symmetric,
 * authenticated) keyed by the single 32-byte `FORGE_SECRET_KEY` master key.
 *
 * `value_enc` is base64(nonce ‖ ciphertext): a fresh random nonce per
 * encryption, prepended to the ciphertext, the whole thing base64-encoded.
 * Decryption is server-side only and never reaches the browser. Plaintext is
 * NEVER logged.
 *
 * The store is kept behind the `SecretStore` interface (`get/put/delete`) so it
 * can move Postgres → Vault later with no call-site changes.
 */

const SECRET_KEY_BYTES = 32; // crypto_secretbox_KEYBYTES

let ready: Promise<void> | null = null;

/** Await libsodium's WASM init exactly once. */
export async function sodiumReady(): Promise<void> {
  if (!ready) {
    ready = sodium.ready;
  }
  await ready;
  return undefined;
}

/**
 * Decode + validate the master key from a base64 string. Fails fast (throws)
 * unless it decodes to exactly 32 bytes — never run with an unusable key.
 */
export function loadMasterKey(base64Key: string | undefined): Uint8Array {
  if (!base64Key || base64Key.trim() === '') {
    throw new Error('FORGE_SECRET_KEY is not set — cannot operate the SecretStore.');
  }
  let decoded: Uint8Array;
  try {
    decoded = sodium.from_base64(base64Key.trim(), sodium.base64_variants.ORIGINAL);
  } catch {
    throw new Error('FORGE_SECRET_KEY is not valid base64.');
  }
  if (decoded.length !== SECRET_KEY_BYTES) {
    throw new Error(
      `FORGE_SECRET_KEY must decode to exactly ${SECRET_KEY_BYTES} bytes (got ${decoded.length}).`,
    );
  }
  return decoded;
}

/**
 * Encrypt `plaintext` under `key` (32 bytes). Returns base64(nonce ‖ ciphertext)
 * with a fresh random 24-byte nonce. Pure — no DB, no logging.
 */
export function encryptSecret(plaintext: string, key: Uint8Array): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const message = sodium.from_string(plaintext);
  const ciphertext = sodium.crypto_secretbox_easy(message, nonce, key);
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, nonce.length);
  return sodium.to_base64(combined, sodium.base64_variants.ORIGINAL);
}

/**
 * Decrypt a base64(nonce ‖ ciphertext) value under `key`. Throws on a MAC
 * failure (tampered ciphertext / wrong key) rather than returning garbage. Pure.
 */
export function decryptSecret(valueEnc: string, key: Uint8Array): string {
  const combined = sodium.from_base64(valueEnc, sodium.base64_variants.ORIGINAL);
  const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
  if (combined.length < nonceBytes + sodium.crypto_secretbox_MACBYTES) {
    throw new Error('Ciphertext is too short to be a valid secretbox value.');
  }
  const nonce = combined.subarray(0, nonceBytes);
  const ciphertext = combined.subarray(nonceBytes);
  const message = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(message);
}

/** The portable secret-storage seam. */
export interface SecretStore {
  /** Encrypt + store a secret; returns the row `id` used as a `*_ref`. */
  put(label: string, plaintext: string, createdBy?: string | null): Promise<string>;
  /** Resolve + decrypt a secret by row `id`; null if the row is absent. */
  get(id: string): Promise<string | null>;
  /** Remove the secret row by `id`. */
  delete(id: string): Promise<void>;
}

/**
 * Postgres-backed `SecretStore` over the `app_secrets` table. The master key is
 * resolved + validated once at construction (fail-fast on a bad key).
 */
export class PostgresSecretStore implements SecretStore {
  private readonly db: Db;
  private readonly key: Uint8Array;

  private constructor(db: Db, key: Uint8Array) {
    this.db = db;
    this.key = key;
  }

  /** Construct after awaiting libsodium init + validating the master key. */
  static async create(opts?: { db?: Db; base64Key?: string }): Promise<PostgresSecretStore> {
    await sodiumReady();
    const key = loadMasterKey(opts?.base64Key ?? process.env.FORGE_SECRET_KEY);
    return new PostgresSecretStore(opts?.db ?? getDb(), key);
  }

  async put(label: string, plaintext: string, createdBy?: string | null): Promise<string> {
    const valueEnc = encryptSecret(plaintext, this.key);
    const [row] = await this.db
      .insert(appSecrets)
      .values({ label, valueEnc, createdBy: createdBy ?? null })
      .returning({ id: appSecrets.id });
    return row.id;
  }

  async get(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ valueEnc: appSecrets.valueEnc })
      .from(appSecrets)
      .where(eq(appSecrets.id, id))
      .limit(1);
    if (!row) return null;
    return decryptSecret(row.valueEnc, this.key);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(appSecrets).where(eq(appSecrets.id, id));
  }
}
