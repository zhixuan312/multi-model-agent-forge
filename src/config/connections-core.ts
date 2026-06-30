import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { connectionSettings } from '@/db/schema/identity';
import { PostgresSecretStore, type SecretStore } from '@/secrets/secret-store';

/**
 * Connections core (Spec 2 §Connections). Reads/updates the singleton
 * `settings_connection` row: the MMA base URL, the Git service token, and the
 * speech-to-text (OpenAI) key. Read-or-create-by-id: the first save creates the
 * single row; later saves UPDATE it. Each section updates independently (a
 * git-only edit leaves the speech-to-text ref untouched).
 *
 * The MMA bearer is NOT stored here — it is owned by the local mma and read
 * from its auth-token file (see `readMmaBearer`); the Connections page shows it
 * read-only. Git + speech-to-text secrets are NEVER stored raw — each is
 * `SecretStore.put`'d and only the returned `settings_secret.id` lands in the
 * matching `*_ref`. Secret values are NEVER returned to callers — the view
 * exposes "set / not set" booleans only.
 */

export interface ConnectionsDeps {
  db?: Db;
  secrets?: SecretStore;
  /** The admin saving this change — recorded on new secret rows (audit → settings_secret.created_by). */
  actorId?: string | null;
}

async function resolveSecrets(deps: ConnectionsDeps): Promise<SecretStore> {
  return deps.secrets ?? (await PostgresSecretStore.create({ db: deps.db }));
}

/** The Connections view — base URL is shown; tokens are booleans, never values. */
export interface ConnectionsView {
  mmaBaseUrl: string | null;
  gitTokenSet: boolean;
  openaiTranscriptionKeySet: boolean;
}

const optionalText = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .optional();

// All fields optional → each section saves independently. A present token
// rotates that secret; an absent token leaves the existing ref untouched.
export const updateConnectionsSchema = z.object({
  mmaBaseUrl: optionalText,
  gitToken: optionalText,
  openaiTranscriptionKey: optionalText,
});

/** Read the singleton row (or the empty view if no row exists yet). */
export async function getConnections(deps: ConnectionsDeps = {}): Promise<ConnectionsView> {
  const db = deps.db ?? getDb();
  const [row] = await db.select().from(connectionSettings).limit(1);
  if (!row) {
    return {
      mmaBaseUrl: null,
      gitTokenSet: false,
      openaiTranscriptionKeySet: false,
    };
  }
  return {
    mmaBaseUrl: row.mmaBaseUrl,
    gitTokenSet: row.gitTokenRef !== null,
    openaiTranscriptionKeySet: row.openaiTranscriptionKeyRef !== null,
  };
}

/** Centralized voice-enabled check — true when an OpenAI transcription key is configured. */
export async function isVoiceEnabled(deps: ConnectionsDeps = {}): Promise<boolean> {
  const c = await getConnections(deps);
  return c.openaiTranscriptionKeySet;
}

export type UpdateConnectionsResult =
  | { kind: 'saved'; connections: ConnectionsView }
  | { kind: 'invalid' };

/**
 * Save (create-or-update) the singleton row. Only the provided fields are
 * touched: a token present is `put` and its ref replaces the old one; a token
 * absent leaves its ref as-is. The base URL is set when provided.
 */
export async function updateConnections(
  input: unknown,
  deps: ConnectionsDeps = {},
): Promise<UpdateConnectionsResult> {
  const db = deps.db ?? getDb();
  const parsed = updateConnectionsSchema.safeParse(input);
  if (!parsed.success) return { kind: 'invalid' };
  const { mmaBaseUrl, gitToken, openaiTranscriptionKey } = parsed.data;

  const [existing] = await db.select().from(connectionSettings).limit(1);

  // Resolve any provided secrets to refs (replacing the prior secret rows).
  let secrets: SecretStore | null = null;
  const needSecrets = gitToken !== undefined || openaiTranscriptionKey !== undefined;
  if (needSecrets) secrets = await resolveSecrets(deps);

  async function rotate(
    plaintext: string | undefined,
    label: string,
    priorRef: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (plaintext === undefined) return undefined; // unchanged
    const ref = await secrets!.put(label, plaintext, deps.actorId ?? null);
    if (priorRef) await secrets!.delete(priorRef); // drop the superseded secret
    return ref;
  }

  const gitTokenRef = await rotate(gitToken, 'git-token', existing?.gitTokenRef);
  const openaiRef = await rotate(
    openaiTranscriptionKey,
    'openai-transcription',
    existing?.openaiTranscriptionKeyRef,
  );

  if (existing) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (mmaBaseUrl !== undefined) patch.mmaBaseUrl = mmaBaseUrl;
    if (gitTokenRef !== undefined) patch.gitTokenRef = gitTokenRef;
    if (openaiRef !== undefined) patch.openaiTranscriptionKeyRef = openaiRef;
    await db.update(connectionSettings).set(patch).where(eq(connectionSettings.id, existing.id));
  } else {
    await db.insert(connectionSettings).values({
      mmaBaseUrl: mmaBaseUrl ?? null,
      gitTokenRef: gitTokenRef ?? null,
      openaiTranscriptionKeyRef: openaiRef ?? null,
    });
  }

  return { kind: 'saved', connections: await getConnections({ db }) };
}
