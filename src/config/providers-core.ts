import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { provider } from '@/db/schema/config';
import { PROVIDER_TYPE } from '@/db/enums';
import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';

/**
 * Providers CRUD core (Spec 2 §Providers). Dependency-injected (`Db` +
 * `SecretStore`) and pure of `next/headers` so it's unit-testable against the
 * live DB. Route handlers (`app/api/providers/**`) are thin shells; admin gating
 * + logging live there.
 *
 * Secret handling: an `apiKey` plaintext is NEVER stored in a `provider` column.
 * It is `SecretStore.put`'d and only the returned `app_secrets.id` is stored in
 * `api_key_ref`. A blank/omitted key leaves `api_key_ref` NULL = provider default.
 * Secret values are NEVER returned to callers — list/read expose `apiKeySet`
 * (a boolean), never the key.
 */

export interface ProvidersDeps {
  db?: Db;
  secrets?: SecretStore;
}

async function resolveSecrets(deps: ProvidersDeps): Promise<SecretStore> {
  return deps.secrets ?? (await PostgresSecretStore.create({ db: deps.db }));
}

// Empty/whitespace string → undefined (treated as "not provided").
const optionalText = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .optional();

export const createProviderSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(PROVIDER_TYPE),
  baseUrl: optionalText,
  apiKey: optionalText, // plaintext — stored via SecretStore, never in a column
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

// All fields optional on update; apiKey present rotates the secret, baseUrl/name/type replace.
export const updateProviderSchema = z.object({
  name: z.string().trim().min(1).optional(),
  type: z.enum(PROVIDER_TYPE).optional(),
  baseUrl: optionalText,
  apiKey: optionalText,
});
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

/** A provider row as exposed to the client — NEVER carries the key, only a flag. */
export interface ProviderView {
  id: string;
  name: string;
  type: (typeof PROVIDER_TYPE)[number];
  baseUrl: string | null;
  apiKeySet: boolean; // true ⟺ api_key_ref is non-NULL (a key is stored)
  createdAt: Date;
}

function toView(row: {
  id: string;
  name: string;
  type: (typeof PROVIDER_TYPE)[number];
  baseUrl: string | null;
  apiKeyRef: string | null;
  createdAt: Date;
}): ProviderView {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.baseUrl,
    apiKeySet: row.apiKeyRef !== null,
    createdAt: row.createdAt,
  };
}

// ---- list ----

export async function listProviders(deps: ProvidersDeps = {}): Promise<ProviderView[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKeyRef: provider.apiKeyRef,
      createdAt: provider.createdAt,
    })
    .from(provider)
    .orderBy(provider.createdAt);
  return rows.map(toView);
}

// ---- create ----

export type CreateProviderResult =
  | { kind: 'created'; provider: ProviderView }
  | { kind: 'invalid' }
  | { kind: 'duplicate_name' };

export async function createProvider(
  input: unknown,
  deps: ProvidersDeps = {},
): Promise<CreateProviderResult> {
  const db = deps.db ?? getDb();
  const parsed = createProviderSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const { name, type, baseUrl, apiKey } = parsed.data;

  // Pre-check the unique name (the column UNIQUE is the real guard for races).
  const [existing] = await db
    .select({ id: provider.id })
    .from(provider)
    .where(eq(provider.name, name))
    .limit(1);
  if (existing) return { kind: 'duplicate_name' };

  // Store the key (if any) FIRST so api_key_ref points at a real secret row.
  let apiKeyRef: string | null = null;
  if (apiKey !== undefined) {
    const secrets = await resolveSecrets(deps);
    apiKeyRef = await secrets.put(`provider:${name}`, apiKey);
  }

  try {
    const [row] = await db
      .insert(provider)
      .values({ name, type, baseUrl: baseUrl ?? null, apiKeyRef })
      .returning({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl,
        apiKeyRef: provider.apiKeyRef,
        createdAt: provider.createdAt,
      });
    return { kind: 'created', provider: toView(row) };
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: 'duplicate_name' };
    throw err;
  }
}

// ---- update ----

export type UpdateProviderResult =
  | { kind: 'updated'; provider: ProviderView }
  | { kind: 'invalid' }
  | { kind: 'not_found' }
  | { kind: 'duplicate_name' };

export async function updateProvider(
  id: string,
  input: unknown,
  deps: ProvidersDeps = {},
): Promise<UpdateProviderResult> {
  const db = deps.db ?? getDb();
  const parsed = updateProviderSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };

  const [current] = await db
    .select({ id: provider.id, name: provider.name, apiKeyRef: provider.apiKeyRef })
    .from(provider)
    .where(eq(provider.id, id))
    .limit(1);
  if (!current) return { kind: 'not_found' };

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.type !== undefined) patch.type = parsed.data.type;
  // baseUrl: explicit empty → clears to NULL; absent key → unchanged.
  if ('baseUrl' in (input as object)) patch.baseUrl = parsed.data.baseUrl ?? null;

  // apiKey: a non-blank value rotates the stored secret; an explicit blank clears it.
  if ('apiKey' in (input as object)) {
    const secrets = await resolveSecrets(deps);
    if (parsed.data.apiKey !== undefined) {
      const ref = await secrets.put(`provider:${parsed.data.name ?? current.name}`, parsed.data.apiKey);
      // Drop the superseded secret so we don't orphan an app_secrets row.
      if (current.apiKeyRef) await secrets.delete(current.apiKeyRef);
      patch.apiKeyRef = ref;
    } else {
      // Explicit clear: drop the stored secret + NULL the ref.
      if (current.apiKeyRef) await secrets.delete(current.apiKeyRef);
      patch.apiKeyRef = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    // No-op update → return the current view.
    const view = await getProviderView(db, id);
    return view ? { kind: 'updated', provider: view } : { kind: 'not_found' };
  }

  try {
    const [row] = await db
      .update(provider)
      .set(patch)
      .where(eq(provider.id, id))
      .returning({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl,
        apiKeyRef: provider.apiKeyRef,
        createdAt: provider.createdAt,
      });
    return { kind: 'updated', provider: toView(row) };
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: 'duplicate_name' };
    throw err;
  }
}

// ---- delete ----

export type DeleteProviderResult = { kind: 'deleted' } | { kind: 'not_found' };

export async function deleteProvider(
  id: string,
  deps: ProvidersDeps = {},
): Promise<DeleteProviderResult> {
  const db = deps.db ?? getDb();
  const [current] = await db
    .select({ id: provider.id, apiKeyRef: provider.apiKeyRef })
    .from(provider)
    .where(eq(provider.id, id))
    .limit(1);
  if (!current) return { kind: 'not_found' };

  // Remove the stored key first so we don't orphan a secret row.
  if (current.apiKeyRef) {
    const secrets = await resolveSecrets(deps);
    await secrets.delete(current.apiKeyRef);
  }
  await db.delete(provider).where(eq(provider.id, id));
  return { kind: 'deleted' };
}

// ---- helpers ----

async function getProviderView(db: Db, id: string): Promise<ProviderView | null> {
  const [row] = await db
    .select({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKeyRef: provider.apiKeyRef,
      createdAt: provider.createdAt,
    })
    .from(provider)
    .where(eq(provider.id, id))
    .limit(1);
  return row ? toView(row) : null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}
